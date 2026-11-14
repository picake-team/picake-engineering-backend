import type { INestApplication } from "@nestjs/common";
import { HttpStatus } from "@nestjs/common";
import * as express from "express";
import { API_PREFIX } from "@apps/backend/common/constants/app.constants";
import {
  QUOTE_PHOTO_READ_ERROR_MESSAGES,
  QUOTE_PHOTO_READ_LIMITS,
} from "@apps/backend/modules/quote-request/constants/quote-photo-read.constants";

/** 사진(data URL)을 JSON으로 받는 경로. 기본 JSON 한도(100kb)로는 1280px 사진도 들어오지 않는다 */
export const PHOTO_READ_PATH = `${API_PREFIX}/consumer/quote-requests/photo-read`;

/**
 * 큰 JSON을 받아도 되는 요청인지: `POST /v1/consumer/quote-requests/photo-read` 딱 하나.
 * 경로 앞부분만 같은 요청(`.../photo-read/x`)·다른 메서드·끝에 `/`를 붙인 요청은 기본 한도(100kb) 그대로다
 * (`app.use(경로, …)`는 앞부분만 맞아도 붙어서 쓰지 않는다)
 */
export function isLargeJsonBodyRequest(req: Pick<express.Request, "method" | "path">): boolean {
  return req.method === "POST" && req.path === PHOTO_READ_PATH;
}

/**
 * 큰 JSON을 받는 요청만 한도를 올린다(다른 요청은 기본 100kb 그대로). `app.init()`/`listen()` 전에 부른다.
 * main.ts와 E2E 테스트 앱이 같이 부른다.
 *
 * 주의: 미들웨어 이름을 `jsonParser`로 두지 않는다. Nest는 이름이 `jsonParser`인 미들웨어가 이미 있으면
 * 기본 JSON 파서를 붙이지 않아 다른 모든 경로의 JSON이 읽히지 않게 된다. 여기서 먼저 읽으면 기본 파서는 건너뛴다
 */
export function applyLargeJsonBodyRoutes(app: INestApplication): void {
  const photoReadJson = express.json({ limit: QUOTE_PHOTO_READ_LIMITS.BODY_LIMIT });
  app.use(function photoReadJsonBody(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    if (!isLargeJsonBodyRequest(req)) {
      next();
      return;
    }
    photoReadJson(req, res, (err?: any) => {
      if (err?.type === "entity.too.large") {
        // 다른 오류 응답과 같은 모양으로
        res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
          success: false,
          data: {
            message: QUOTE_PHOTO_READ_ERROR_MESSAGES.TOO_LARGE,
            statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          },
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        });
        return;
      }
      next(err);
    });
  });
}
