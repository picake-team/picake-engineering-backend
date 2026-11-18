import { SetMetadata } from "@nestjs/common";

export const ALLOW_ACT_AS_METADATA_KEY = "picake:allow-act-as";

/**
 * 운영자가 가게 대신 입력하는 출입증(`type: act_as`, 기획 I-41)으로도 부를 수 있는 판매자 경로.
 *
 * 기본은 막는다: 이 표시가 없는 경로는 `AuthGuard`가 대리 출입증을 403으로 돌려보낸다. 그래서 판매자 경로가 새로
 * 생겨도 여기 붙이기 전까지는 닫혀 있다. 컨트롤러(클래스)에는 붙이지 않고 경로(메서드)마다 붙인다 —
 * 클래스에 붙이면 나중에 그 컨트롤러에 더한 경로가 저절로 열리기 때문이다(가드도 메서드 표시만 읽는다).
 * 무엇을 열었는지는 `act-as-allowlist.spec.ts` 표와 같아야 한다.
 */
export const AllowActAs = () => SetMetadata(ALLOW_ACT_AS_METADATA_KEY, true);
