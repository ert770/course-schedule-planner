// 泛用的 TTL promise 快取：到期前重複呼叫回傳同一個 pending/resolved promise
// （dedupe 同時發生的併發呼叫），到期後才重新產生。失敗的 promise 不快取，
// 避免一次查詢失敗後在 TTL 內持續回傳同一個 rejection。
//
// `now` 可注入，測試不必真的等待就能驗證到期行為。
export function createTtlCache(producer, ttlMs, now = Date.now) {
  let pending = null;
  let expiresAt = 0;

  return async function getCached() {
    const currentTime = now();
    if (pending && expiresAt > currentTime) {
      return pending;
    }

    const promise = producer();
    pending = promise;
    expiresAt = currentTime + ttlMs;

    try {
      return await promise;
    } catch (err) {
      // 只清掉「自己仍是目前最新一代」的 pending。若這個 promise 已過期、
      // 一個更新的 generation 已經取代它成為 pending，此時它才 reject，
      // 不得把新 generation 也清掉——否則會把 dedupe 直接打破：後續呼叫
      // 誤以為沒有進行中的查詢，各自重新起一個 producer，在資料庫本就
      // 不穩定（逾時、暫時性錯誤）的時候反而造成 query stampede。
      if (pending === promise) {
        pending = null;
      }
      throw err;
    }
  };
}

export default { createTtlCache };
