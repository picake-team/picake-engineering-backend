/**
 * Claude가 "보낸 사진이 문제라" 받지 않았나(손님·사장님 사진 문제 → 횟수를 세고 400으로 답한다).
 * 400(깨진 사진·모양이 안 맞음)과 413(너무 큼)만 그렇다. 401·403·404(키 회수·권한·모델 이름)와
 * 크레딧 부족(400이지만 billing 글)은 우리 쪽 문제라 한도를 되돌리고 5xx로 답해야 한다 —
 * 전에는 4xx를 모두 사진 문제로 봐서 키가 막히면 모든 손님이 "JPG나 PNG 사진만 읽을 수 있어요"를 봤다(11-18 검토).
 */
export function isClaudeImageRejection(error: unknown): boolean {
  const e = error as {
    status?: number;
    message?: string;
    error?: { error?: { message?: string } };
  };
  if (e?.status !== 400 && e?.status !== 413) return false;
  const text = `${e?.message ?? ""} ${e?.error?.error?.message ?? ""}`;
  return !/credit balance|billing|\bplan\b|\bquota\b/i.test(text);
}
