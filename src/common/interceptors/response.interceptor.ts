// src/common/interceptors/response.interceptor.ts

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// src/common/interceptors/response.interceptor.ts

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();

    return next.handle().pipe(
      map((data) => {
        // Array
        if (Array.isArray(data)) {
          return {
            success: true,
            statusCode: response.statusCode,
            message: 'Request successful',
            data,
          };
        }

        // Object
        const { message, ...rest } = data ?? {};
        const hasPaginatedData = Object.prototype.hasOwnProperty.call(rest, 'data');
        const hasMeta = Object.prototype.hasOwnProperty.call(rest, 'meta');
        const hasSummary = Object.prototype.hasOwnProperty.call(rest, 'summary');

        if (hasPaginatedData || hasMeta || hasSummary) {
          return {
            success: true,
            statusCode: response.statusCode,
            message: message ?? 'Request successful',
            ...rest,
          };
        }

        const hasData = Object.keys(rest).length > 0;

        return {
          success: true,
          statusCode: response.statusCode,
          message: message ?? 'Request successful',
          ...(hasData && { data: rest }),
        };
      }),
    );
  }
}