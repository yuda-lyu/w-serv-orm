import { types } from 'util'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import take from 'lodash-es/take.js'
import map from 'lodash-es/map.js'


//摘要中列出之失敗位置數上限, 同getMapOrm之getMsgFail
const N_SHOW = 10

//逐筆結果摘要至多掃描的元素數
const N_SCAN = 100000

//cpDetail之上限: 深度, 處理的節點與鍵合計數; 超過者以標記字串代替(不交出原參照)
const CP_DEPTH = 8
const CP_MAX = 5000

//二進位資料byteLength的內建getter
const BL_AB = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get
const BL_TA = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get
const BL_DV = Object.getOwnPropertyDescriptor(DataView.prototype, 'byteLength').get

//Error的stack於V8為自有存取器, 其getter為同一realm內共用的內建函數: 僅當描述子的getter與此相同才讀取(不執行使用端程式)
const STACK_GETTER = (() => {
    try {
        let d = Object.getOwnPropertyDescriptor(new Error(), 'stack')
        return d !== undefined && !Object.prototype.hasOwnProperty.call(d, 'value') && typeof d.get === 'function' ? d.get : null
    }
    catch (e) {
        return null
    }
})()

//錯誤類別名稱與代碼的白名單樣式: 只放行建構子名稱, 以及系統與資料庫慣用之機器代碼(ENOENT、ERR_xxx、SQLSTATE 5碼), 其餘(可能夾帶資料值之文字或數字)不進預設輸出
const RE_ERR_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

//SQLSTATE 5碼之類別碼(前2碼)全集: 只放行已知類別, 使任意5碼大寫字串(如使用者識別)不通過
const SQLSTATE_CLASSES = ['00', '01', '02', '03', '08', '09', '0A', '0B', '0F', '0K', '0L', '0P', '0Z', '20', '21', '22', '23', '24', '25', '26', '27', '28', '2B', '2D', '2F', '34', '38', '39', '3B', '3D', '3F', '40', '42', '44', '53', '54', '55', '57', '58', '72', 'F0', 'HV', 'HW', 'HY', 'P0', 'XX']
const RE_ERR_CODE = /^(E[A-Z0-9]{2,15}|ERR_[A-Z0-9_]{1,40}|[0-9A-Z]{5})$/

function isErrCode(c) {
    //錯誤代碼是否為機器代碼: 絕對值至99999之整數; ENOENT類、ERR_開頭、SQLSTATE(前2碼為已知類別)之字串
    if (Number.isInteger(c)) {
        return Math.abs(c) <= 99999
    }
    if (typeof c !== 'string' || !RE_ERR_CODE.test(c)) {
        return false
    }
    return c.length !== 5 || c.startsWith('E') || c.startsWith('ERR_') || SQLSTATE_CLASSES.indexOf(c.slice(0, 2)) >= 0
}


function getOptLog(opt) {
    //診斷輸出的設定(R-DIAG-01), 供WServOrm建構時使用: 型別錯誤即拋Error, 與建構期其他設定(checkOptRemoved、addFun*)一致; undefined與null視為未給(同checkOptRemoved)
    //logDetail: 布林, 預設false; true時console輸出還原為含主鍵與錯誤原文的完整細節(供除錯)
    //funLog: 函數(label, safe, detail), 預設無; 給予時診斷輸出只交給它(不寫console), detail為完整細節(含主鍵與錯誤原文), 供使用端遮罩或轉送
    //回傳固定快照{ logDetail, funLog }, 其後各路徑(procOrm、recover等)共用此快照, 不再讀取使用端的opt(getter可能前後不同)
    let logDetail = get(opt, 'logDetail')
    if (logDetail !== undefined && logDetail !== null && typeof logDetail !== 'boolean') {
        throw new Error('invalid opt.logDetail, need a boolean')
    }
    let funLog = get(opt, 'funLog')
    if (funLog !== undefined && funLog !== null && typeof funLog !== 'function') {
        throw new Error('invalid opt.funLog, need a function')
    }
    return { logDetail: logDetail === true, funLog: typeof funLog === 'function' ? funLog : null }
}


function getOptLogLoose(opt) {
    //同getOptLog, 但型別錯誤者忽略並用預設(安全輸出), 讀取opt拋錯者亦同, 與工具路徑(getDb、genTestData、getSettings)的bLog等選項一致
    //各選項分別讀取, 單一getter拋錯只丟該選項, 不連累另一個有效選項
    let logDetail = false
    try {
        logDetail = get(opt, 'logDetail') === true
    }
    catch (e) {
        //忽略
    }
    let funLog = null
    try {
        let f = get(opt, 'funLog')
        funLog = typeof f === 'function' ? f : null
    }
    catch (e) {
        //忽略
    }
    return { logDetail, funLog }
}


function noop() {
    //吞下funLog回傳之promise的reject
}


function swallow(r) {
    //funLog的回傳若為promise或thenable, 附上reject處理, 使其reject不成為unhandledRejection; 全程不使診斷輸出拋錯
    //原生promise用內建then(不讀其可被覆寫的then屬性); 其他thenable只讀一次then並以其為this呼叫, 回傳之原生promise亦附處理
    try {
        if (types.isPromise(r)) {
            Promise.prototype.then.call(r, undefined, noop)
            return
        }
        if (r !== null && (typeof r === 'object' || typeof r === 'function')) {
            let t = r.then
            if (typeof t === 'function') {
                let x = t.call(r, undefined, noop)
                if (types.isPromise(x)) {
                    Promise.prototype.then.call(x, undefined, noop)
                }
            }
        }
    }
    catch (e) {
        //放棄
    }
}


function getDiag(optLog) {
    //回傳診斷輸出函數diag(label, safe, getDetail, bare), 所有診斷輸出皆經此(R-DIAG-01); src內除本函數外不得直接呼叫console
    //label: 固定標籤(含表名); safe: 不含主鍵、資料值與錯誤原文的摘要(預設輸出), 無則undefined; getDetail: 回傳完整細節的函數(只在有消費者時才呼叫), 無細節則undefined
    //bare: 為true者, logDetail還原時只輸出細節而不加label(舊版該站即為console.log(細節))
    //輸出不得使呼叫端的流程拋錯: 細節的取得、console與funLog的拋錯一律吞下; funLog回傳的promise之reject亦吞下
    let { logDetail, funLog } = optLog === undefined ? getOptLogLoose(undefined) : optLog
    return (label, safe, getDetail, bare = false) => {

        //args, 完整細節; 僅在需要時取得
        let getArgs = () => {
            if (getDetail === undefined) {
                return []
            }
            try {
                return [getDetail()]
            }
            catch (e) {
                return ['(unprintable)']
            }
        }

        //funLog, 取代console輸出
        if (funLog !== null) {
            try {
                swallow(funLog(label, safe, ...getArgs()))
            }
            catch (e) {
                //放棄輸出
            }
            return
        }

        //console, 預設為安全摘要; logDetail為true時還原完整細節(診斷用之console.log: 引數若含使用端物件會被格式化, 拋錯不得使procOrm之reject變成例外物件, R-ERR-01 規則5)
        try {
            if (logDetail) {
                console.log(...(bare ? [] : [label]), ...getArgs())
            }
            else if (safe === undefined) {
                console.log(label)
            }
            else {
                console.log(label, safe)
            }
        }
        catch (e) {
            try {
                console.log(label, '(unprintable)')
            }
            catch (e2) {
                //放棄輸出
            }
        }
    }
}


function readData(o, k) {
    //取o(含原型鏈)上資料屬性k之值, 不執行getter、不觸發Proxy陷阱(遇Proxy即止); 非資料屬性或無則undefined
    for (let x = o; x !== null && !types.isProxy(x); x = Object.getPrototypeOf(x)) {
        let d = Object.getOwnPropertyDescriptor(x, k)
        if (d !== undefined) {
            return Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : undefined
        }
    }
    return undefined
}


function getBriefErr(e) {
    //錯誤(ORM或後端拋出的值)的摘要: 只列類別與代碼, 不含訊息文字; 全程不執行getter與使用端程式
    //字串(各ORM常以字串reject)列為string; 原生Error取其建構子名稱(程式識別字, 非資料; 驅動程式的錯誤類別常以存取器宣告name, 故不取name);
    //代碼(自有資料屬性code)限系統與資料庫慣用之機器代碼樣式: 有限整數(絕對值至99999)或ENOENT、ERR_xxx、SQLSTATE 5碼之字串
    try {
        if (typeof e === 'string') {
            return { errType: 'string' }
        }
        if (e === null || (typeof e !== 'object' && typeof e !== 'function')) {
            return { errType: e === null ? 'null' : typeof e }
        }
        if (types.isProxy(e)) {
            return { errType: 'Proxy' }
        }
        let r = { errType: typeof e === 'function' ? 'function' : 'object' }
        if (types.isNativeError(e)) {
            let ctor = readData(e, 'constructor')
            let cname = typeof ctor === 'function' && !types.isProxy(ctor) ? readData(ctor, 'name') : undefined
            r.errType = typeof cname === 'string' && RE_ERR_TYPE.test(cname) ? cname : 'Error'
        }
        let code = Object.prototype.hasOwnProperty.call(e, 'code') ? Object.getOwnPropertyDescriptor(e, 'code') : undefined
        if (code !== undefined && Object.prototype.hasOwnProperty.call(code, 'value')) {
            let c = code.value
            if (isErrCode(c)) {
                r.errCode = c
            }
        }
        return r
    }
    catch (e2) {
        return { errType: 'unknown' }
    }
}


function getBriefFails(fails) {
    //失敗清單([{k, ...}])的摘要: 筆數與前N_SHOW筆的位置k, 不含主鍵與錯誤原文
    return {
        n: size(fails),
        ks: map(take(fails, N_SHOW), (v) => {
            return v !== null && typeof v === 'object' && Number.isInteger(v.k) ? v.k : null
        }),
    }
}


const UNSAFE = Symbol('unsafe')


function readOk(v) {
    //逐筆結果元素的ok: 沿原型鏈只讀資料屬性; 遇存取器或Proxy(元素本身或其原型鏈上)無從安全判讀, 回UNSAFE; 無ok回undefined
    for (let x = v; x !== null; x = Object.getPrototypeOf(x)) {
        if (types.isProxy(x)) {
            return UNSAFE
        }
        let d = Object.getOwnPropertyDescriptor(x, 'ok')
        if (d !== undefined) {
            return Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : UNSAFE
        }
    }
    return undefined
}


function getBriefResult(r) {
    //ORM寫入類函數的回傳結果(呼叫端已以isOrmFail判為失敗者)的摘要: 逐筆陣列列失敗筆數與位置; 聚合物件為{ ok: 0 }(判為失敗者其ok即0, 不再讀取其ok, 避免getter前後不同); Proxy不探測
    try {
        if (types.isProxy(r)) {
            return { type: 'Proxy' }
        }
        if (Array.isArray(r)) {
            let ks = []
            let n = 0
            let nScan = Math.min(r.length, N_SCAN) //掃描筆數上限(稀疏或巨大陣列不使診斷無限耗時), 超過者計入skipped
            let skipped = r.length - nScan
            let protoNonStd = Object.getPrototypeOf(r) !== Array.prototype
            for (let k = 0; k < nScan; k++) {
                let d = Object.getOwnPropertyDescriptor(r, k)
                if (d !== undefined && !Object.prototype.hasOwnProperty.call(d, 'value')) {
                    skipped++ //索引為存取器: 不執行, 以skipped標示摘要不完整
                    continue
                }
                if (d === undefined && protoNonStd) {
                    skipped++ //空洞且陣列的原型不是標準原型: 該索引可能由原型提供, 無從安全判讀
                    continue
                }
                let v = d !== undefined ? d.value : undefined
                let ok = v !== null && typeof v === 'object' ? readOk(v) : undefined
                if (ok === UNSAFE) {
                    skipped++ //元素為Proxy、其原型鏈有Proxy或ok為存取器: 不執行, 不計入
                    continue
                }
                if (ok === 0) {
                    n++
                    if (ks.length < N_SHOW) {
                        ks.push(k)
                    }
                }
            }
            return skipped > 0 ? { n, ks, skipped } : { n, ks }
        }
        if (r !== null && typeof r === 'object') {
            return { ok: 0 }
        }
        return { type: typeof r }
    }
    catch (e) {
        return { type: 'unknown' }
    }
}


function cpAddKeys(src, dst, keys, st, depth) {
    //把src的自有屬性(依keys)複製到dst: 資料屬性遞迴複製, 存取器不執行而以標記字串代替(保留其鍵); 每個鍵(含存取器)都計入預算, 預算用盡即停(其餘鍵不複製, 不交出原參照)
    for (let k of keys) {
        if (st.n >= CP_MAX) {
            break
        }
        let d = Object.getOwnPropertyDescriptor(src, k)
        if (d === undefined) {
            continue
        }
        st.n++
        if (!Object.prototype.hasOwnProperty.call(d, 'value')) {
            Object.defineProperty(dst, k, { value: '[Getter/Setter]', writable: true, enumerable: d.enumerable, configurable: true })
            continue
        }
        Object.defineProperty(dst, k, { value: cpDetail(d.value, st, depth + 1), writable: d.writable, enumerable: d.enumerable, configurable: true })
    }
}


function cpDetail(v, st = { n: 0 }, depth = 0) {
    //交給funLog之完整細節的拷貝: 細節若與其後仍要使用的物件共用(拋給呼叫端的Error、傳給模型產生器的schema、失敗清單等), 使用端原地遮罩會改變結果
    //只用內建操作複製, 不執行使用端程式(不呼叫getter、實例方法、建構子), 不交出原參照:
    //  複製: 純物件與類別實例(保留原型參照、複製自有屬性)、陣列(含空洞、長度與自有非索引鍵)、原生Error(含stack)、Date、Map、Set;
    //  標記字串代替: 函數('[Function]')、Proxy('[Proxy]')、RegExp('[RegExp]')、二進位資料(Buffer、TypedArray、DataView、ArrayBuffer: '[Binary n bytes]', SharedArrayBuffer: '[SharedArrayBuffer]')、
    //  Promise與WeakMap等無法複製的內建物件('[Object]')、深度超過8或處理的節點與鍵合計超過5000者('[Truncated]'); 原型物件不複製(類別實例與其複本共用原型, 原型上的可變狀態仍共用)
    if (v === null) {
        return v
    }
    if (typeof v === 'function') {
        return '[Function]'
    }
    if (typeof v !== 'object') {
        return v
    }
    if (depth >= CP_DEPTH || st.n >= CP_MAX) {
        return '[Truncated]'
    }
    st.n++
    try {
        if (types.isProxy(v)) {
            return '[Proxy]'
        }
        if (Array.isArray(v)) {
            let r = new Array(v.length)
            cpAddKeys(v, r, Reflect.ownKeys(v).filter((k) => k !== 'length'), st, depth)
            return r
        }
        if (types.isRegExp(v)) {
            return '[RegExp]'
        }
        if (types.isArrayBuffer(v)) {
            return `[Binary ${BL_AB.call(v)} bytes]`
        }
        if (types.isTypedArray(v)) {
            return `[Binary ${BL_TA.call(v)} bytes]`
        }
        if (types.isDataView(v)) {
            return `[Binary ${BL_DV.call(v)} bytes]`
        }
        if (types.isSharedArrayBuffer(v)) {
            return '[SharedArrayBuffer]'
        }
        if (types.isPromise(v) || types.isWeakMap(v) || types.isWeakSet(v) || types.isBoxedPrimitive(v) || types.isGeneratorObject(v) || types.isMapIterator(v) || types.isSetIterator(v) || types.isModuleNamespaceObject(v) || types.isExternal(v)) {
            return '[Object]'
        }
        let r = null
        if (types.isDate(v)) {
            r = new Date(Date.prototype.getTime.call(v))
        }
        else if (types.isMap(v)) {
            r = new Map()
            for (let [k, x] of Map.prototype.entries.call(v)) {
                if (st.n >= CP_MAX) {
                    break
                }
                st.n++
                r.set(cpDetail(k, st, depth + 1), cpDetail(x, st, depth + 1))
            }
        }
        else if (types.isSet(v)) {
            r = new Set()
            for (let x of Set.prototype.values.call(v)) {
                if (st.n >= CP_MAX) {
                    break
                }
                st.n++
                r.add(cpDetail(x, st, depth + 1))
            }
        }
        else {
            r = Object.create(Object.getPrototypeOf(v))
        }
        cpAddKeys(v, r, Reflect.ownKeys(v), st, depth)
        if (types.isNativeError(v)) {
            //stack於V8為自有存取器(上方cpAddKeys只留標記): 僅當其getter嚴格等於同realm共用之內建getter、且回傳為字串時, 才取其值以資料屬性放入拷貝(使還原舊輸出時仍含堆疊); 其餘不執行
            let sd = Object.getOwnPropertyDescriptor(v, 'stack')
            if (STACK_GETTER !== null && sd !== undefined && sd.get === STACK_GETTER) {
                let s = STACK_GETTER.call(v)
                Object.defineProperty(r, 'stack', { value: typeof s === 'string' ? s : '[Uncopyable]', writable: true, enumerable: false, configurable: true })
            }
        }
        return r
    }
    catch (e) {
        return '[Uncopyable]'
    }
}


function getBriefType(v) {
    //任意值的型別摘要(不含值): 供呼叫端傳入之無效參數(ds、WOrm、url、db、woItems、fp)的預設輸出
    try {
        if (v === null) {
            return { type: 'null' }
        }
        if (types.isProxy(v)) {
            return { type: 'Proxy' }
        }
        return { type: Array.isArray(v) ? 'array' : typeof v }
    }
    catch (e) {
        return { type: 'unknown' }
    }
}


function getBriefCount(v) {
    //資料列清單的筆數: 只認非Proxy之真陣列(不讀其length以外, 不執行getter), 其餘為null
    try {
        return Array.isArray(v) && !types.isProxy(v) ? v.length : null
    }
    catch (e) {
        return null
    }
}


export { getOptLog, getOptLogLoose, getDiag, getBriefErr, getBriefFails, getBriefResult, getBriefType, getBriefCount, cpDetail }
