FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    DATABASE_URL=sqlite:////var/lib/socragate/socragate.db \
    LLM_PROVIDER=offline

WORKDIR /app
COPY backend/requirements-lock.txt ./backend/requirements-lock.txt
RUN pip install --no-cache-dir -r backend/requirements-lock.txt \
    && groupadd --gid 10001 socragate \
    && useradd --uid 10001 --gid socragate --no-create-home socragate \
    && mkdir -p /var/lib/socragate \
    && chown socragate:socragate /var/lib/socragate

COPY backend/ ./backend/
COPY data/ ./data/

USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
