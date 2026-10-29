//hookKit.mjs: 擴充函數(addFunCheck、addFunPreProcessing、addFunPostProcessing)註冊後約1毫秒才生效(src/getProc.mjs addFun),
//測試以其opt.onTrace之'active'事件為同步點, 不以固定毫秒等待(規格: 計時器相關函數之觀察回調與測試, P1; 規則帳本 R-TRACE-01)

//真實計時器於模組載入時保存, 防懸置上限不受假時鐘影響
let realSetTimeout = setTimeout
let realClearTimeout = clearTimeout

//防懸置上限(毫秒): 只防事件永不來而整案懸置(如生效邏輯被破壞), 不是同步點; 正常時事件在數毫秒內到, 此值不影響正確實作之結果
let MS_GUARD = 10000


//addHook, 註冊擴充函數並回傳Promise, 於該函數實際生效(onTrace之'active'事件)時resolve為事件物件; 註冊即拋錯(非函數)時Promise以該錯誤reject
//name為'addFunCheck'、'addFunPreProcessing'或'addFunPostProcessing'
function addHook(so, name, f) {
    return new Promise((resolve, reject) => {
        let tm = realSetTimeout(() => {
            reject(new Error(`${name} 未於 ${MS_GUARD} ms 內生效(未收到 active 事件)`))
        }, MS_GUARD)
        tm.unref()
        try {
            so[name](f, {
                onTrace: (e) => {
                    realClearTimeout(tm)
                    resolve(e)
                },
            })
        }
        catch (err) {
            realClearTimeout(tm)
            throw err
        }
    })
}


//settle, 以註冊一個無作用之check並等其生效, 作為屏障: 同一實例先前註冊之擴充函數若有排定之生效(計時器同為1ms, 依註冊先後生效), 此時必已生效或已確定不會生效
//用於「註冊失敗(非函數)不應留下任何效果」之否定觀察, 取代固定等待
function settle(so) {
    return addHook(so, 'addFunCheck', () => {})
}


export { addHook, settle }
