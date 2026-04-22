"""Thin S3 helpers for the user file library.

Credentials are pulled from app.config (loaded by src.utils.config.load_secrets).
"""

import logging

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from flask import current_app

logger = logging.getLogger(__name__)


def get_s3_client():
    return boto3.client(
        's3',
        aws_access_key_id=current_app.config.get('AWS_ACCESS_KEY_ID'),
        aws_secret_access_key=current_app.config.get('AWS_SECRET_ACCESS_KEY'),
        region_name=current_app.config.get('AWS_REGION'),
    )


def get_bucket():
    return current_app.config.get('AWS_S3_BUCKET_NAME')


def upload_file(local_path: str, key: str, content_type: str | None = None) -> str:
    extra = {'ContentType': content_type} if content_type else {}
    get_s3_client().upload_file(local_path, get_bucket(), key, ExtraArgs=extra)
    return key


def delete_object(key: str) -> None:
    try:
        get_s3_client().delete_object(Bucket=get_bucket(), Key=key)
    except (ClientError, BotoCoreError) as e:
        logger.error(f"S3 delete failed for {key}: {e}")


def generate_download_url(
    key: str,
    expires_in: int = 300,
    filename: str | None = None,
) -> str:
    params = {'Bucket': get_bucket(), 'Key': key}
    if filename:
        params['ResponseContentDisposition'] = f'attachment; filename="{filename}"'
    return get_s3_client().generate_presigned_url(
        'get_object', Params=params, ExpiresIn=expires_in
    )
