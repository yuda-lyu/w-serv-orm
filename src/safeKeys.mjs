//本套件診斷摘要之安全鍵名單(公開, R-DIAG-02): 單一來源, 供本套件之getDiag(cfg.safeKeys)與下游伺服端轉接器(wsemi之genDiagFunLog(write, { safeKeys }))共用
//
//零 import: 下游以 w-serv-orm/src/safeKeys.mjs 深層匯入(同src/baseline.mjs之慣例), 不得再匯入本套件之內部檔
//名單為凍結陣列(下游無法改動); 其內容即本套件funLog所產生之safe的頂層鍵(errType、errCode由wsemi恆含, 不列於此)
//新增本套件之safe鍵時須同步於此登錄, 測試以實際funLog產出比對, 漏列者由測試判紅


/**
 * 本套件funLog所產生之safe(安全摘要)的頂層鍵白名單，凍結之字串陣列，供下游伺服端把本套件之funLog轉寫至日誌時作為第二道防線
 *
 * 下游(w-web-sso、w-web-api、w-web-task、w-web-perm等)以wsemi之genDiagFunLog(write, { safeKeys })接管本套件之opt.funLog時，safeKeys應傳此名單，使轉寫至伺服器日誌之safe只含本套件宣告之鍵(errType、errCode由wsemi恆含，不必列入)；
 * 本套件自身之getDiag亦以此名單為cfg.safeKeys，白名單外之鍵於產生端即丟棄，故此名單與本套件實際產出之鍵一致(單一來源)
 *
 * 規則見sgud/rule/rulebook_diag.md之R-DIAG-02(跨套件規格為主控dspec〈診斷輸出與遮罩〉)
 *
 * @type {Array<String>}
 * @example
 *
 * import genDiagFunLog from 'wsemi/src/genDiagFunLog.mjs'
 * import { SAFE_KEYS } from 'w-serv-orm/src/safeKeys.mjs'
 *
 * let { funLog } = genDiagFunLog((o) => console.log(o), { safeKeys: SAFE_KEYS })
 * let so = WServOrm(ds, WOrm, url, db, { funLog })
 *
 */
const SAFE_KEYS = Object.freeze(['n', 'ks', 'skipped', 'ok', 'type', 'reason', 'msgs', 'table', 'tables', 'keys', 'nOther'])


export { SAFE_KEYS }
