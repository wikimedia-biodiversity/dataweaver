"""WSGI entry point: ``gunicorn app:app`` (Toolforge Build Service) or ``flask --app app run`` (local)."""
from dataweaver import create_app

app = create_app()
