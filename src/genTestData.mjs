import get from 'lodash-es/get.js'
import isbol from 'wsemi/src/isbol.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'


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
            await woItems[k].save(rs)

            if (bLog) {
                console.log(`${k}.funTest and save`, rs)
            }
        }

    })

}


export default genTestData
