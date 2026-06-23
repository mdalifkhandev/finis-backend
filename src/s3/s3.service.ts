import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';

@Injectable()
export class S3Service {
    private s3: S3Client;
    private bucket: string;
    private region: string;

    constructor(private config: ConfigService) {
        this.region = this.config.getOrThrow<string>('AWS_REGION');
        this.bucket = this.config.getOrThrow<string>('AWS_S3_BUCKET_NAME');

        this.s3 = new S3Client({
            region: this.region,
            credentials: {
                accessKeyId: this.config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
                secretAccessKey: this.config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
            },
        });
    }

    async uploadFile(
        file: Express.Multer.File,
        folder: string = 'uploads',
    ): Promise<string> {
        const ext = extname(file.originalname);
        const key = `${folder}/${uuidv4()}${ext}`;

        await this.s3.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype,
            }),
        );

        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }

    async deleteFile(fileUrl: string): Promise<void> {
        try {
            const key = fileUrl.includes('.amazonaws.com/')
                ? fileUrl.split('.amazonaws.com/')[1]
                : fileUrl.replace(/^\/+/, '');
            if (!key) return;

            await this.s3.send(
                new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                }),
            );
        } catch {
            // ignore
        }
    }
}
