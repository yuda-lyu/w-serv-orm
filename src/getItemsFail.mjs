import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import isarr from 'wsemi/src/isarr.mjs'


function getItemsFail(rs, data) {
    //由ORM逐筆函數(save、del)之回傳結果取出失敗者, 回傳[{k,id,err}], k為該筆於輸入內之位置
    //w-orm系列規格: 逐筆函數回傳與輸入等長保序之陣列, 單筆失敗時整批仍resolve, 該筆以ok為0並附err回報, 須由呼叫端逐筆檢查
    //逐筆結果不含主鍵, 故主鍵取自輸入之同位置數據

    //check, 未依規格之ORM可能回傳非陣列, 無從逐筆檢查
    if (!isarr(rs)) {
        return []
    }

    //check, 輸入為單一物件時ORM回傳長度為1之陣列
    if (!isarr(data)) {
        data = [data]
    }

    //fails, 僅ok為0者視為失敗
    let fails = []
    each(rs, (v, k) => {
        if (get(v, 'ok') === 0) {
            fails.push({
                k,
                id: get(data, [k, 'id']),
                err: get(v, 'err', ''),
            })
        }
    })

    return fails
}


export default getItemsFail
