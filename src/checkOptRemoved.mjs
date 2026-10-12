import get from 'lodash-es/get.js'


function checkOptRemoved(opt) {
    //已移除之設定: 未給、null或false者接受(使用端現行之設定), 其餘值拋錯, 避免使用端以為仍有檢查而無聲失去
    //useCheckUser只查使用者存在且有效, 屬認證而非授權, 卻曾被當成授權; procOrm不做授權, 須由procOrm開放給前端之處負責
    //useExcludeWhenNotAdmin依賴只有useCheckUser才產生之isAdmin, 未開useCheckUser時會把所有人當非管理者過濾, 一併移除
    //收opt之進入點(WServOrm、getProc)皆須呼叫, 直接呼叫getProc者亦不得靜默忽略
    //使用端包裝層可直接呼叫以檢查其自身之opt, 只看這三鍵, opt之其他鍵不受影響, 通過時回傳undefined
    let msgAuth = 'procOrm does not authorize users, authorize where procOrm is exposed to clients'
    let ks = [
        ['useCheckUser', msgAuth],
        ['getUserById', msgAuth],
        ['useExcludeWhenNotAdmin', 'procOrm does not filter select results by user, use addFunPostProcessing if needed'],
    ]
    for (let [k, hint] of ks) {
        let v = get(opt, k)
        if (v !== undefined && v !== null && v !== false) {
            throw new Error(`opt.${k} has been removed, ${hint}`)
        }
    }
}


export default checkOptRemoved
