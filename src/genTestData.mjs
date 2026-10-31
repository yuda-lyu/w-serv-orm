import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import isbol from 'wsemi/src/isbol.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import getItemsFail from 'w-data-collector/src/getItemsFail.mjs'
import isOrmFail from './isOrmFail.mjs'
import { genDiag, getBriefCount } from './getDiagBrief.mjs'


/**
 * 離線產製測試資料(公開子模組，見README〈公開子模組〉)
 *
 * 逐表(依ds之鍵序，一次一表)處理，任一表失敗即停止、之後之表不執行。預設mode為'funTestAndSave'：呼叫ds[表].funTestAndSave(woItems)；mode為'funTest'：呼叫ds[表].funTest(woItems)取資料列，經opt.hookFunTestData(rows)(同步，選用)轉換後交woItems[表].save(rows)，save回報失敗(逐筆或聚合ok為0)即拋Error，訊息起首為`failed to write test data into table[表名]: `；mode非此二值者同預設。
 * 使用端函數(funTestAndSave、funTest、hookFunTestData)與ORM拋出或reject之值為外來值，含連線憑證者轉出遮罩後之副本，見README〈對外錯誤值〉；診斷輸出依opt.bLog、opt.logDetail、opt.funLog(型別錯誤者忽略並用預設)，見README〈Diagnostic output〉。
 *
 * @param {Object} ds 輸入資料表設定物件，各表含funTestAndSave或funTest函數
 * @param {Object} woItems 輸入各資料表ORM實例物件(如WServOrm回傳物件之woItems)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.mode='funTestAndSave'] 輸入模式字串，可為'funTestAndSave'或'funTest'，預設'funTestAndSave'
 * @param {Function} [opt.hookFunTestData] 輸入mode為'funTest'時轉換資料列之同步函數(rows)，預設無
 * @param {Boolean} [opt.bLog=true] 輸入是否輸出進度訊息，預設true
 * @param {Boolean} [opt.logDetail=false] 輸入是否輸出含細節(連線憑證已遮罩)之診斷，預設false
 * @param {Function} [opt.funLog] 輸入使用端提供之紀錄函式(label, safe, detail)，給予時診斷輸出只交給它
 * @returns {Promise<undefined>} 回傳Promise，成功resolve undefined，失敗reject
 * @example
 *
 * import genTestData from 'w-serv-orm/src/genTestData.mjs'
 *
 * await genTestData(ds, woItems)
 * await genTestData(ds, woItems, { mode: 'funTest', hookFunTestData: (rows) => rows })
 *
 */
async function genTestData(ds, woItems, opt = {}) {

    //bLog
    let bLog = get(opt, 'bLog')
    if (!isbol(bLog)) {
        bLog = true
    }

    //diag, bLog為true時之輸出預設只列筆數而不列資料列(含主鍵), opt.logDetail為true輸出遮罩後之細節, opt.funLog收遮罩後之細節(R-DIAG-01); 型別錯誤者忽略, 同bLog
    //外來值(ds之funTestAndSave、funTest、hookFunTestData與ORM之save拋出或reject之值)經diag.err後轉出; 寫入失敗之Error訊息只對ORM回傳原文之段經diag.mask
    let diag = genDiag(opt)

    //ext, 呼叫外部函數, 其拋出或reject之值經diag.err
    let ext = async (fn) => {
        try {
            return await fn()
        }
        catch (err) {
            throw diag.err(err)
        }
    }

    //mode
    let mode = get(opt, 'mode')
    if (mode !== 'funTestAndSave' && mode !== 'funTest') {
        mode = 'funTestAndSave'
    }

    //hookFunTestData
    let hookFunTestData = get(opt, 'hookFunTestData')

    //pmSeries
    await pmSeries(ds, async (v, k) => {

        if (mode === 'funTestAndSave') {

            //funTestAndSave
            let rs = await ext(() => v.funTestAndSave(woItems))

            if (bLog) {
                diag(`${k}.funTestAndSave`, { n: getBriefCount(rs) }, () => rs)
            }
        }
        else {

            //funTest
            let rs = await ext(() => v.funTest(woItems))

            //hookFunTestData
            if (isfun(hookFunTestData)) {
                try {
                    rs = hookFunTestData(rs) //同步呼叫(同舊版)
                }
                catch (err) {
                    throw diag.err(err)
                }
            }

            //save
            let rss = await ext(() => woItems[k].save(rs))

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rss, rs)
            if (size(fails) > 0) {
                throw new Error(`failed to write test data into table[${k}]: ${diag.mask(JSON.stringify(fails))}`)
            }

            //check, 回傳聚合物件而ok為0(非契約形狀)者無從逐筆列出, 仍視為失敗, 內文列ORM回傳原文(R-ORM-RESULT-01)
            if (isOrmFail(rss)) {
                throw new Error(`failed to write test data into table[${k}]: ${diag.mask(JSON.stringify(rss))}`)
            }

            if (bLog) {
                diag(`${k}.funTest and save`, { n: getBriefCount(rs) }, () => rs)
            }
        }

    })

}


export default genTestData
