import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import isbol from 'wsemi/src/isbol.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import getItemsFail from 'w-data-collector/src/getItemsFail.mjs'
import isOrmFail from './isOrmFail.mjs'
import { genDiag, getBriefCount } from './getDiagBrief.mjs'


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
