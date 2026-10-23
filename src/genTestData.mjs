import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import isbol from 'wsemi/src/isbol.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import getItemsFail from 'w-data-collector/src/getItemsFail.mjs'
import isOrmFail from './isOrmFail.mjs'


async function genTestData(ds, woItems, opt = {}) {

    //bLog
    let bLog = get(opt, 'bLog')
    if (!isbol(bLog)) {
        bLog = true
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
            let rs = await v.funTestAndSave(woItems)

            if (bLog) {
                console.log(`${k}.funTestAndSave`, rs)
            }
        }
        else {

            //funTest
            let rs = await v.funTest(woItems)

            //hookFunTestData
            if (isfun(hookFunTestData)) {
                rs = hookFunTestData(rs)
            }

            //save
            let rss = await woItems[k].save(rs)

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rss, rs)
            if (size(fails) > 0) {
                throw new Error(`failed to write test data into table[${k}]: ${JSON.stringify(fails)}`)
            }

            //check, 回傳聚合物件而ok為0(非契約形狀)者無從逐筆列出, 仍視為失敗, 內文列ORM回傳原文(R-ORM-RESULT-01)
            if (isOrmFail(rss)) {
                throw new Error(`failed to write test data into table[${k}]: ${JSON.stringify(rss)}`)
            }

            if (bLog) {
                console.log(`${k}.funTest and save`, rs)
            }
        }

    })

}


export default genTestData
