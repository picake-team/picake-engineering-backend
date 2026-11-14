import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";

import { LikeDesignCreateService } from "@apps/backend/modules/like/services/like-design-create.service";
import { LikeDesignDeleteService } from "@apps/backend/modules/like/services/like-design-delete.service";
import { LikeDesignListService } from "@apps/backend/modules/like/services/like-design-list.service";
import { AuthWithdrawService } from "@apps/backend/modules/auth/services/auth-withdraw.service";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import type { AuthAppleOauthService } from "@apps/backend/modules/auth/services/auth-apple-oauth.service";
import type { QuoteRequestCleanupService } from "@apps/backend/modules/quote-request/services/quote-request-cleanup.service";
import type { ChatCleanupService } from "@apps/backend/modules/chat/services/chat-cleanup.service";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import { createTestConsumer } from "@apps/backend/test/integration/factories";

/**
 * 케이크 디자인 모음 좋아요(기획 I-112)를 실제 Postgres로 확인한다:
 * 두 번 눌러도 하나, 취소, 디자인별 수, 내 좋아요 순서, 탈퇴하면 지워짐.
 */
describe("디자인 좋아요 (integration)", () => {
  function build() {
    const prisma = getTestPrisma();
    return {
      prisma,
      create: new LikeDesignCreateService(prisma),
      remove: new LikeDesignDeleteService(prisma),
      list: new LikeDesignListService(prisma),
    };
  }

  it("두 번 눌러도 하나로 남고(동시에 눌러도), 취소는 누르지 않았어도 성공한다", async () => {
    const { prisma, create, remove } = build();
    const consumer = await createTestConsumer(prisma);

    await create.addDesignLikeForUser(consumer.id, "bento-heart-lettering");
    await create.addDesignLikeForUser(consumer.id, "bento-heart-lettering");
    await Promise.all([
      create.addDesignLikeForUser(consumer.id, "mini-ribbon"),
      create.addDesignLikeForUser(consumer.id, "mini-ribbon"),
    ]);
    expect(await prisma.designLike.count({ where: { consumerId: consumer.id } })).toBe(2);

    await remove.removeDesignLikeForUser(consumer.id, "bento-heart-lettering");
    await remove.removeDesignLikeForUser(consumer.id, "bento-heart-lettering");
    await remove.removeDesignLikeForUser(consumer.id, "never-liked");
    expect(
      (await prisma.designLike.findMany({ where: { consumerId: consumer.id } })).map(
        (l) => l.designId,
      ),
    ).toEqual(["mini-ribbon"]);
  });

  it("디자인 ID 모양이 틀리면 디자인을 찾을 수 없다고 막는다", async () => {
    const { prisma, create, remove } = build();
    const consumer = await createTestConsumer(prisma);
    for (const id of ["Bento", "bento_heart", "bento--heart", "-a", "", "a".repeat(81), "케이크"]) {
      await expect(create.addDesignLikeForUser(consumer.id, id)).rejects.toThrow(
        new BadRequestException("디자인을 찾을 수 없어요."),
      );
      await expect(remove.removeDesignLikeForUser(consumer.id, id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(await prisma.designLike.count()).toBe(0);
  });

  it("디자인별 수(1개 이상만)와 내 좋아요(최근 누른 순), 로그인하지 않으면 내 좋아요는 []", async () => {
    const { prisma, create, remove, list } = build();
    const a = await createTestConsumer(prisma);
    const b = await createTestConsumer(prisma);

    await create.addDesignLikeForUser(a.id, "first");
    await create.addDesignLikeForUser(a.id, "second");
    await create.addDesignLikeForUser(a.id, "third");
    await create.addDesignLikeForUser(b.id, "second");
    await create.addDesignLikeForUser(b.id, "gone");
    await remove.removeDesignLikeForUser(b.id, "gone");
    // 같은 시각에 눌러도 순서가 흔들리지 않게 시각을 정해 둔다
    const at = (s: string) => new Date(`2026-11-14T${s}+09:00`);
    await prisma.designLike.updateMany({
      where: { consumerId: a.id, designId: "first" },
      data: { createdAt: at("10:00:00") },
    });
    await prisma.designLike.updateMany({
      where: { consumerId: a.id, designId: "second" },
      data: { createdAt: at("12:00:00") },
    });
    await prisma.designLike.updateMany({
      where: { consumerId: a.id, designId: "third" },
      data: { createdAt: at("11:00:00") },
    });

    const mine = await list.getDesignLikes(a.id);
    expect(mine.counts).toEqual({ first: 1, second: 2, third: 1 });
    expect(mine.myLikes).toEqual(["second", "third", "first"]);

    expect(await list.getDesignLikes(b.id)).toEqual({
      counts: { first: 1, second: 2, third: 1 },
      myLikes: ["second"],
    });
    expect(await list.getDesignLikes(undefined)).toEqual({
      counts: { first: 1, second: 2, third: 1 },
      myLikes: [],
    });
  });

  it("탈퇴하면 그 손님의 디자인 좋아요를 지우고 수에서도 빠진다(계정은 익명화만 해서 자동으로 지워지지 않음)", async () => {
    const { prisma, create, list } = build();
    const leaving = await createTestConsumer(prisma);
    const staying = await createTestConsumer(prisma);
    await create.addDesignLikeForUser(leaving.id, "bento-heart-lettering");
    await create.addDesignLikeForUser(leaving.id, "mini-ribbon");
    await create.addDesignLikeForUser(staying.id, "bento-heart-lettering");

    const withdraw = new AuthWithdrawService(
      prisma,
      { revokeToken: vi.fn() } as unknown as AuthAppleOauthService,
      {
        deleteAllForConsumer: vi.fn().mockResolvedValue({ requests: 0, photos: 0 }),
      } as unknown as QuoteRequestCleanupService,
      {
        deleteAllForConsumer: vi.fn().mockResolvedValue({ messages: 0, photos: 0 }),
      } as unknown as ChatCleanupService,
    );
    await withdraw.withdraw(AUDIENCE.CONSUMER, leaving.id, "테스트");

    expect(await prisma.designLike.count({ where: { consumerId: leaving.id } })).toBe(0);
    expect((await list.getDesignLikes(undefined)).counts).toEqual({ "bento-heart-lettering": 1 });
    // 계정은 익명화로 남는다
    expect(
      (await prisma.consumer.findUniqueOrThrow({ where: { id: leaving.id } })).withdrawnAt,
    ).not.toBeNull();
  });
});
