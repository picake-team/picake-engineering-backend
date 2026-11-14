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

  it("손님 한 명은 300개까지: 넘으면 400, 이미 누른 디자인은 한도에서도 성공, 하나 취소하면 다시 누를 수 있다", async () => {
    const { prisma, create, remove } = build();
    const consumer = await createTestConsumer(prisma);
    const ids = Array.from({ length: 299 }, (_, i) => `cap-${i}`);
    await prisma.designLike.createMany({
      data: ids.map((designId) => ({ consumerId: consumer.id, designId })),
    });

    await create.addDesignLikeForUser(consumer.id, "cap-new-a");
    await expect(create.addDesignLikeForUser(consumer.id, "cap-new-b")).rejects.toThrow(
      new BadRequestException("좋아요는 300개까지 할 수 있어요."),
    );
    await create.addDesignLikeForUser(consumer.id, "cap-0");
    expect(await prisma.designLike.count({ where: { consumerId: consumer.id } })).toBe(300);

    await remove.removeDesignLikeForUser(consumer.id, "cap-0");
    await create.addDesignLikeForUser(consumer.id, "cap-new-b");
    expect(await prisma.designLike.count({ where: { consumerId: consumer.id } })).toBe(300);

    // 다른 손님은 따로 센다
    const other = await createTestConsumer(prisma);
    await create.addDesignLikeForUser(other.id, "cap-new-b");
  });

  it("한도 바로 앞에서 동시에 여러 개를 눌러도 300개를 넘지 않는다", async () => {
    const { prisma, create } = build();
    const consumer = await createTestConsumer(prisma);
    await prisma.designLike.createMany({
      data: Array.from({ length: 299 }, (_, i) => ({
        consumerId: consumer.id,
        designId: `r-${i}`,
      })),
    });

    const results = await Promise.allSettled(
      ["race-a", "race-b", "race-c"].map((id) => create.addDesignLikeForUser(consumer.id, id)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    }
    expect(await prisma.designLike.count({ where: { consumerId: consumer.id } })).toBe(300);
  });

  it("수는 많은 순 500개까지(같으면 ID 순), 내 좋아요는 300개까지만 돌려준다", async () => {
    const { prisma, list } = build();
    const heavy = await createTestConsumer(prisma);
    const b = await createTestConsumer(prisma);
    const c = await createTestConsumer(prisma);
    // 한도가 생기기 전처럼 직접 넣어 501개를 만든다(서비스로는 300개까지라 못 만든다)
    const ids = Array.from({ length: 501 }, (_, i) => `d-${String(i).padStart(3, "0")}`);
    await prisma.designLike.createMany({
      data: ids.map((designId) => ({ consumerId: heavy.id, designId })),
    });
    await prisma.designLike.createMany({
      data: [
        { consumerId: b.id, designId: "d-500" },
        { consumerId: c.id, designId: "d-500" },
        { consumerId: b.id, designId: "d-499" },
      ],
    });

    const { counts, myLikes } = await list.getDesignLikes(heavy.id);
    expect(Object.keys(counts)).toHaveLength(500);
    expect(counts["d-500"]).toBe(3);
    expect(counts["d-499"]).toBe(2);
    expect(counts["d-000"]).toBe(1);
    expect(counts["d-497"]).toBe(1);
    // 1개짜리 499개 중 ID 순으로 뒤인 d-498이 잘린다
    expect(counts).not.toHaveProperty("d-498");
    expect(Object.values(counts).every((n) => n >= 1)).toBe(true);
    expect(myLikes).toHaveLength(300);
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
