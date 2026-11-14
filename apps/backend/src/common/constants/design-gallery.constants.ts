/**
 * 케이크 디자인 모음(기획 I-112). 디자인은 DB가 아니라 웹(web-user)에 있고, 서버는 웹이 정한 디자인 ID만 받는다.
 * ID는 소문자·숫자를 하이픈으로 이은 모양(예: `bento-heart-lettering`). 좋아요(DesignLike)와 견적 요청서 참고 사진이 같이 쓴다.
 */
export const DESIGN_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const DESIGN_ID_MAX_LENGTH = 80;

export function isValidDesignId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= DESIGN_ID_MAX_LENGTH &&
    DESIGN_ID_PATTERN.test(value)
  );
}
