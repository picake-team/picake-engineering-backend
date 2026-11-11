import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type, Transform } from "class-transformer";
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from "class-validator";

export class SellerNotificationListQueryDto {
  @ApiProperty({ description: "스토어 ID (cuid)" })
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @ApiPropertyOptional({ description: "안 읽음만" })
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 20;
}

export class SellerNotificationMarkAllReadBodyDto {
  @ApiProperty({ description: "스토어 ID (cuid)" })
  @IsString()
  @IsNotEmpty()
  storeId: string;
}

export class SellerNotificationPreferenceQueryDto {
  @ApiProperty({ description: "스토어 ID (cuid)" })
  @IsString()
  @IsNotEmpty()
  storeId: string;
}

export class SellerNotificationPreferenceUpdateDto {
  @ApiProperty({ description: "스토어 ID (cuid)" })
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  orderNotificationsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  orderNotificationSoundEnabled?: boolean;

  @ApiPropertyOptional({
    description: "판매자 앱 아침 요약 휴대폰 알림(매일 8시, 그날 픽업이 있을 때만). 기본 켬",
  })
  @IsOptional()
  @IsBoolean()
  morningSummaryEnabled?: boolean;

  @ApiPropertyOptional({ description: "채팅 알림(판매자 앱 알림·알림톡). 기본 켬" })
  @IsOptional()
  @IsBoolean()
  chatNotificationsEnabled?: boolean;

  @ApiPropertyOptional({ description: "밤 9시~아침 8시에는 채팅 알림 끄기. 기본 끔" })
  @IsOptional()
  @IsBoolean()
  chatQuietNight?: boolean;
}

export class SellerNotificationItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty({ enum: ["SELLER_WEB"] })
  appSurface: "SELLER_WEB";

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty()
  read: boolean;

  @ApiProperty()
  storeId: string;

  @ApiProperty()
  orderId: string;
}

export class SellerNotificationListResponseDto {
  @ApiProperty({ type: [SellerNotificationItemResponseDto] })
  data: SellerNotificationItemResponseDto[];

  @ApiProperty()
  meta: {
    currentPage: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export class SellerNotificationPreferenceResponseDto {
  @ApiProperty({ enum: ["SELLER_WEB"] })
  appSurface: "SELLER_WEB";

  @ApiProperty()
  orderNotificationsEnabled: boolean;

  @ApiProperty()
  orderNotificationSoundEnabled: boolean;

  @ApiProperty({ description: "판매자 앱 아침 요약 휴대폰 알림. 기본 켬" })
  morningSummaryEnabled: boolean;

  @ApiProperty({ description: "채팅 알림(판매자 앱 알림·알림톡). 기본 켬" })
  chatNotificationsEnabled: boolean;

  @ApiProperty({ description: "밤 9시~아침 8시에는 채팅 알림 끄기. 기본 끔" })
  chatQuietNight: boolean;
}

export class SellerNotificationUnreadCountQueryDto {
  @ApiProperty({ description: "스토어 ID (cuid)" })
  @IsString()
  @IsNotEmpty()
  storeId: string;
}

export class SellerNotificationUnreadCountResponseDto {
  @ApiProperty()
  count: number;
}
