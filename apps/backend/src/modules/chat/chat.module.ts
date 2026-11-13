import { Module } from "@nestjs/common";
import { DatabaseModule } from "@apps/backend/infra/database/database.module";
import { UploadModule } from "@apps/backend/modules/upload/upload.module";
import { FcmModule } from "@apps/backend/modules/fcm/fcm.module";
import { NotificationModule } from "@apps/backend/modules/notification/notification.module";
import { OpsAlertModule } from "@apps/backend/modules/ops-alert/ops-alert.module";
import { SolapiModule } from "@apps/backend/modules/solapi/solapi.module";
import { ChatNotifyService } from "@apps/backend/modules/chat/services/chat-notify.service";
import { ChatService } from "@apps/backend/modules/chat/services/chat.service";
import { ChatAdminService } from "@apps/backend/modules/chat/services/chat-admin.service";
import { ChatCleanupService } from "@apps/backend/modules/chat/services/chat-cleanup.service";
import { ChatAlimtalkService } from "@apps/backend/modules/chat/services/chat-alimtalk.service";

/**
 * 채팅 모듈(기획 I-11) 1단계: 손님 × 입점 가게.
 * - 방은 손님 1명 × 가게 명부(shops) 1곳에 하나. 첫 글을 보낼 때 생긴다
 * - 새 글은 알림 소켓(`/notifications`)의 `chat_updated` 신호(내용 없음) + 휴대폰 알림
 * - 따로 여는 시각 없이 배포하면 열린다(운영자 11-12)
 * - 상대 글을 앱 알림으로 못 봤거나 안 읽으면 1분마다 도는 ChatAlimtalkService가 카카오 알림톡을 보낸다(11-13)
 * 옛 채팅(modules/chat의 소켓 채팅, chat_rooms·messages 표)은 쓰지 않아 코드와 표를 지웠다(표는 20261112010000_drop_legacy_chat, 운영자 결정 11-12).
 */

@Module({
  imports: [
    DatabaseModule,
    UploadModule,
    FcmModule,
    NotificationModule,
    OpsAlertModule,
    SolapiModule,
  ],
  providers: [
    ChatNotifyService,
    ChatService,
    ChatAdminService,
    ChatCleanupService,
    ChatAlimtalkService,
  ],
  exports: [ChatService, ChatAdminService, ChatCleanupService],
})
export class ChatModule {}
