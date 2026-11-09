FROM python:3.12-alpine
COPY tests/docker/inference.py /fixture/inference.py
CMD ["python", "/fixture/inference.py"]
