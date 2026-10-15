// 測試用 Persona 帳號（user_id 9001～9010，組員建立的測試人物，不是真實使用者）。
//
// 協同過濾判斷「真人」時不能只看同意來源：Persona 在瀏覽器裡登入、在隱私中心按儲存，
// 同意來源一樣是 privacy_center。以帳號本身判定，Persona 的資料永遠不會進正式共現表，
// 也不會計入啟用門檻。
export const PERSONA_USER_IDS = Object.freeze(Array.from({ length: 10 }, (_, index) => 9001 + index));

export function isPersonaAccount(user) {
  return PERSONA_USER_IDS.includes(Number(user?.id));
}

export default { PERSONA_USER_IDS, isPersonaAccount };
