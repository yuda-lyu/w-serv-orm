//cpuBound.mjs: 效能時限類斷言(「處理量有界、不展開、不依length迭代」)之量測, 供測試以CPU時間而非牆鐘時間判斷
//規格: 計時器相關函數之觀察回調與測試 P6(真時間測試隔離: 集中標記、裕度依負載試驗訂定、改斷言相對於負載穩定之量, 不以重試掩蓋); 規則帳本 R-TRACE-01
//
//為何不用Date.now()差: 牆鐘時間含行程被排程器擱置(CPU壓力、他套件之測試)的時間, 同一份工作在滿載機器上可慢數倍至數十倍, 與「處理量是否有界」無關;
//本行程耗用之CPU時間(process.cpuUsage, user+system)不含被擱置之時間, 工作量失控(展開指數個物件、依length迭代)時仍成比例增長, 故偵測力不變
//量測區間內須不讓出到會跑他人回呼之巨任務(僅await已解決之Promise與微任務), 否則同一行程內他人之CPU耗用(如負載試驗之事件迴圈阻塞)亦會計入; 本套件之各案皆符合
//
//各案之裕度(CPU毫秒)於各測試處標示; 依負載試驗(CPU壓力8行程、事件迴圈阻塞400:1000、重度阻塞1500:3000)之實測最大值訂定, 見規則帳本 R-TRACE-01
//環境變數 SERVORM_CPUBOUND_LOG 給予檔案路徑時, 每次量測追加一行JSON({label, cpu, wall}), 供訂定裕度時彙整(未給則不寫)
import fs from 'fs'


let fnLog = process.env.SERVORM_CPUBOUND_LOG || ''


function rec(label, cpu, wall) {
    if (fnLog) {
        fs.appendFileSync(fnLog, `${JSON.stringify({ label, cpu, wall })}\n`)
    }
}


//cpuMs, 量測async函數fn執行期間本行程耗用之CPU毫秒(user+system); 回傳{ r, cpu }, r為fn之結果; fn拋錯或reject則原樣轉出(不量測)
async function cpuMs(fn, label = '') {
    let t0 = performance.now()
    let c0 = process.cpuUsage()
    let r = await fn()
    let c = process.cpuUsage(c0)
    let cpu = (c.user + c.system) / 1000
    rec(label, cpu, performance.now() - t0)
    return { r, cpu }
}


//cpuMsSync, 同步版
function cpuMsSync(fn, label = '') {
    let t0 = performance.now()
    let c0 = process.cpuUsage()
    let r = fn()
    let c = process.cpuUsage(c0)
    let cpu = (c.user + c.system) / 1000
    rec(label, cpu, performance.now() - t0)
    return { r, cpu }
}


export { cpuMs, cpuMsSync }
