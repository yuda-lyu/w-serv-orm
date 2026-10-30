//diagSpy.mjs: wsemi getDiag之記錄替身, 供unit-diagsafe取得本套件各診斷站點「過濾前」交給diag之safe(R-DIAG-02)
//
//getDiag依cfg.safeKeys丟棄白名單外之鍵, 故從funLog只看得到過濾後之結果, 無法發現「站點產出了某鍵而SAFE_KEYS漏列」;
//測試把src複製到test/_tmp, 將其getDiag之匯入換為本檔, 站點經真實程式執行, 本檔在轉交真正之getDiag前記下label與safe之原始值
//記錄存於模組內(同一程序內本檔只載入一次), 測試以 takeSeen() 取出並清空

import getDiag from 'wsemi/src/getDiag.mjs'


let seen = []


function wrap(diag) {
    let wrapped = function(label, safe, ...rest) {
        //只記一般物件之自有可列舉鍵與值之淺拷貝(站點交的safe皆為純資料); 其餘記為null
        let isPlain = safe !== null && typeof safe === 'object' && Object.getPrototypeOf(safe) === Object.prototype
        seen.push({ label, safe: isPlain ? { ...safe } : null })
        return diag(label, safe, ...rest)
    }
    Object.assign(wrapped, diag)
    wrapped.with = (src) => wrap(diag.with(src))
    return wrapped
}


function spyGetDiag(opt, cfg) {
    return wrap(getDiag(opt, cfg))
}


function takeSeen() {
    let r = seen
    seen = []
    return r
}


export default spyGetDiag
export { takeSeen }
