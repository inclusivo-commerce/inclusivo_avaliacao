"""Disposable loopback PostgreSQL + unmodified application for accessibility tests.

No .env changes, no test HTTP endpoints and no connections to the development DB.
All secrets and database files stay under results/<run>/private (Git ignored).
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'backend'
sys.path.insert(0, str(BACKEND))


def checked_work(value):
    # Restringe os arquivos da instância descartável à pasta de resultados.
    work = Path(value).resolve()
    allowed = (ROOT / 'accessibility' / 'results').resolve()
    if not work.is_relative_to(allowed) or work == allowed:
        raise RuntimeError('Sandbox must stay inside accessibility/results/<run>/private')
    return work


def save(path, data):
    path.write_text(json.dumps(data, indent=2), encoding='utf-8')


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def pg_bin():
    configured = os.environ.get('A11Y_PG_BIN')
    if configured:
        return Path(configured)
    config = shutil.which('pg_config')
    if config:
        return Path(subprocess.check_output([config, '--bindir'], text=True).strip())
    candidates = sorted(Path('C:/Program Files/PostgreSQL').glob('*/bin'), reverse=True)
    if candidates:
        return candidates[0]
    raise RuntimeError('PostgreSQL utilities missing; set A11Y_PG_BIN')


def utility(work, name, *args):
    config = json.loads((work / 'runtime.json').read_text(encoding='utf-8'))
    executable = Path(config['pgBin']) / (name + ('.exe' if os.name == 'nt' else ''))
    with (work / 'operations.log').open('a', encoding='utf-8') as log:
        result = subprocess.run([str(executable), *map(str, args)], stdout=log, stderr=log, timeout=60, check=False)
    if result.returncode:
        raise RuntimeError(f'{name} failed; inspect private/operations.log')


def configure(work):
    config = json.loads((work / 'runtime.json').read_text(encoding='utf-8'))
    os.environ.update(config['environment'])
    return config


def prepare(work):
    # Uma pasta nova impede reaproveitar banco ou credenciais de outra rodada.
    work.mkdir(parents=True, exist_ok=False)
    port = free_port()
    config = {
        'pgBin': str(pg_bin()), 'apiPort': free_port(), 'pgPort': port,
        'environment': {
            'DATABASE_URL': f'postgresql+psycopg2://a11y@127.0.0.1:{port}/postgres',
            'JWT_SECRET': secrets.token_urlsafe(48), 'JWT_ALGORITHM': 'HS256',
            'ACCESS_TOKEN_EXPIRE_MINUTES': '60', 'TWO_FACTOR_TOKEN_EXPIRE_MINUTES': '5',
            'PAYMENT_PROVIDER': 'development', 'MP_ACCESS_TOKEN': '',
            'ENABLE_DEMO_SEED': 'false', 'PRODUCT_IMAGE_STORAGE': 'local',
            'PRODUCT_UPLOAD_DIR': str(work / 'uploads'), 'AVATAR_UPLOAD_DIR': str(work / 'avatars'),
            'CLOUDINARY_API_KEY': '', 'CLOUDINARY_API_SECRET': '', 'CLOUDINARY_CLOUD_NAME': '',
            'EMAIL_HOST': '127.0.0.1', 'SMTP_HOST': '127.0.0.1', 'EMAIL_PORT': '9',
            'EMAIL_USER': 'no-mail', 'EMAIL_PASS': secrets.token_urlsafe(24),
            'FRONTEND_BASE_URL': 'http://127.0.0.1', 'BACKEND_PUBLIC_URL': '',
            'PASSWORD_RESET_TTL_MINUTES': '10', 'PLATFORM_FEE_PERCENT': '10',
        },
    }
    save(work / 'runtime.json', config)
    utility(work, 'initdb', '-D', work / 'postgres', '-U', 'a11y', '-A', 'trust', '--encoding=UTF8', '--no-locale')
    utility(work, 'pg_ctl', '-D', work / 'postgres', '-l', work / 'postgres.log', '-o', f'-h 127.0.0.1 -p {port}', '-w', 'start')
    try:
        configure(work)
        with (work / 'migrations.log').open('w', encoding='utf-8') as log:
            result = subprocess.run([sys.executable, '-m', 'alembic', 'upgrade', 'head'], cwd=BACKEND, env=os.environ.copy(), stdout=log, stderr=log, timeout=120, check=False)
        if result.returncode:
            raise RuntimeError('Alembic failed; inspect private/migrations.log')
        create_case(work, 'public')
        save(work / 'prepared.json', {'status': 'prepared', 'apiPort': config['apiPort'], 'database': 'disposable-postgresql', 'migrations': 'alembic-upgrade-head'})
    except Exception:
        stop(work)
        raise


def create_case(work, key):
    if not key.isalnum() or len(key) > 40:
        raise RuntimeError('Invalid case key')
    configure(work)
    from app.database.local_bootstrap import load_models
    load_models()
    from app.core.database import SessionLocal
    from app.core.security.passwords import hash_password
    from app.core.security.tokens import create_access_token
    from app.modules.identity.infrastructure.model import User, Client, Seller
    from app.modules.product.domain.model import Product
    from app.modules.address.domain.model import Address
    from app.models.shared_purchase import SharedPurchase
    password = secrets.token_urlsafe(24)
    accounts = {}
    with SessionLocal() as db:
        for role in ('buyer', 'seller'):
            email = f'{role}-{key}@accessibility.example.test'
            user = User(name=f'Avaliador {role} {key}', email=email, type='client' if role == 'buyer' else 'seller', password=hash_password(password))
            db.add(user)
            db.flush()
            if role == 'buyer':
                db.add(Client(user_id=user.id, name=user.name, email=email, address='Endereço de teste', cpf=f'{user.id:011}', phone='11999990000'))
                db.add(Address(user_id=user.id, recipient_name=user.name, zip_code='01001000', street='Praça de teste', number='1', district='Centro', city='São Paulo', state='SP', is_primary=True))
            else:
                store = Seller(user_id=user.id, name=user.name, store=True, store_name=f'Loja de avaliação {key}', cep='01001000', address='Praça de teste', city='São Paulo', state='SP')
                db.add(store)
                db.flush()
            accounts[role] = {'id': user.id, 'email': email, 'password': password}
        products = {}
        for label, stock in [('available', 8), ('unavailable', 0), ('expiring', 3)]:
            product = Product(name=f'A11y {label} {key}', seller_id=store.id, size=40, price=200, stock=stock, foot_type='pair', brand='Inclusivo', model='Avaliação', category='Casual', color='Azul', gender='Unissex', age_group='Adulto', weight=0.5, image_url='/placeholder.svg', description='Produto exclusivo da avaliação automatizada.')
            db.add(product)
            db.flush()
            products[label] = {'id': product.id, 'name': product.name}
        reservation = SharedPurchase(product_id=products['expiring']['id'], creator_user_id=accounts['buyer']['id'], creator_side='left', status='waiting', stock_reserved=True, price_snapshot=200, expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1))
        db.add(reservation)
        db.commit()
        expired = create_access_token(accounts['buyer']['id'], expires_minutes=-1)
        data = {'accounts': accounts, 'products': products, 'reservationId': reservation.id, 'expiredToken': expired}
    cases = work / 'cases'
    cases.mkdir(exist_ok=True)
    save(cases / f'{key}.json', data)
    return data


def expire(work, key):
    configure(work)
    case = json.loads((work / 'cases' / f'{key}.json').read_text(encoding='utf-8'))
    from app.database.local_bootstrap import load_models
    load_models()
    from app.core.database import SessionLocal
    from app.models.shared_purchase import SharedPurchase
    with SessionLocal() as db:
        reservation = db.get(SharedPurchase, case['reservationId'])
        reservation.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
        db.commit()


def serve(work):
    config = configure(work)
    # Bloqueia conexões externas neste processo sem modificar o código da aplicação.
    original = socket.socket.connect
    def connect(sock, address):
        if isinstance(address, tuple) and address[0] not in ('127.0.0.1', '::1', 'localhost'):
            raise OSError('External network disabled in accessibility sandbox')
        return original(sock, address)
    socket.socket.connect = connect
    import uvicorn
    from app.main import app
    from app.core.config import settings
    if settings.database_url != config['environment']['DATABASE_URL'] or settings.payment_provider != 'development' or settings.product_image_storage != 'local':
        raise RuntimeError('Sandbox settings isolation check failed')
    # Desativa limites de requisição apenas nesta instância; eles não são o alvo da avaliação.
    from slowapi import Limiter
    for module in list(sys.modules.values()):
        limiter = getattr(module, 'limiter', None)
        if isinstance(limiter, Limiter):
            limiter.enabled = False
    uvicorn.run(app, host='127.0.0.1', port=config['apiPort'], access_log=False, log_level='warning')


def stop(work):
    if (work / 'postgres' / 'postmaster.pid').exists():
        utility(work, 'pg_ctl', '-D', work / 'postgres', '-m', 'fast', '-w', 'stop')
    save(work / 'stopped.json', {'status': 'stopped'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('prepare', 'serve', 'case', 'expire', 'stop'))
    parser.add_argument('--work-dir', required=True)
    parser.add_argument('--key', default='')
    args = parser.parse_args()
    work = checked_work(args.work_dir)
    if args.action == 'prepare': prepare(work)
    elif args.action == 'serve': serve(work)
    elif args.action == 'case': create_case(work, args.key)
    elif args.action == 'expire': expire(work, args.key)
    else: stop(work)

if __name__ == '__main__':
    main()
