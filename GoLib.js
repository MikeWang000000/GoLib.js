const axios = require("axios");
const cron = require("cron");
const fs = require("fs");
const vm2 = require("vm2");
const URL = require("url").URL;

process.env.TZ = "Asia/Shanghai";
axios.defaults.timeout = 3000;


const Status = {
    IDLE: "IDLE",
    RESERVED: "RESERVED",
    STUDYING: "STUDYING"
};


/*
    由微信OAuth 2.0服务端返回的重定向 URI，向“我去图书馆”获取wechatSESS_ID。
*/
const authorize = async url => {
    let code = new URL(url).searchParams.get("code");
    if (!code)
        throw "Auth code not found";
    let response = await axios.get('http://wechat.v2.traceint.com/index.php/url/auth.html?r=%2F&state=&code=' + code, {
        headers: {
            "Accept": "*/*",
            "User-Agent": "MicroMessenger/8.0.2"
        },
        maxRedirects: 0,
        validateStatus: status => {
            return status < 500;
        }
    });
    let sessid = null;
    for (let c of response.headers['set-cookie']) {
        if (c.search('wechatSESS_ID=') == 0) {
            sessid = c.split('=')[1]?.split(';')[0];
            break;
        }
    }
    if (sessid == null)
        throw "Auth failure";
    return sessid;
};


/*
    由“我去图书馆”返回的HTTP Header获得远程服务器时间。
*/
const getServerDate = async url => {
    let response = await axios.get('http://wechat.v2.traceint.com/', {
        headers: {
            "Accept": "*/*",
            "User-Agent": "MicroMessenger/8.0.2"
        }
    });
    return new Date(response.headers['date']);
};


/*
    用户类
*/
const User = class {
    constructor(sessid) {
        this.sessid = sessid;
    }

    get header() {
        return {
            "Accept": "*/*",
            "User-Agent": "MicroMessenger/8.0.2",
            "Cookie": "wechatSESS_ID=" + this.sessid
        }
    }

    async httpGet(url) {
        let response = await axios.get(url, {
            headers: this.header
        });
        return response.data;
    }

    async httpPost(url, data) {
        let response = await axios.post(url, data, {
            headers: this.header
        });
        return response.data;
    }

    async name() {
        let html = await this.httpGet('https://wechat.v2.traceint.com/index.php/center.html');
        if (!html)
            return null;
        let regrex = /<div class="nick">(.*?)<\/div>/;
        return regrex.exec(html)?.pop() || null;
    }

    async status() {
        let html = await this.httpGet('https://wechat.v2.traceint.com/index.php/reserve/index.html');
        if (html.indexOf("到馆签到") != -1)
            return Status.RESERVED;
        else if (html.indexOf("已学习") != -1)
            return Status.STUDYING;
        else
            return Status.IDLE;
    }

    async countdown() {
        let html = await this.httpGet('https://wechat.v2.traceint.com/index.php/reserve/index.html');
        let regrex = /请在\s+([0-9]+):([0-9]+)\s+前到馆签到/;
        let m = regrex.exec(html);
        if (!m)
            return -1;
        let current = new Date();
        let deadline_hour = parseInt(m[1]);
        let deadline_min = parseInt(m[2]);

        // 返回剩余秒数
        return  (deadline_hour - current.getHours()) * 3600 +
                (deadline_min  - current.getMinutes()) * 60 -
                current.getSeconds();
    }

    async getSeats(roomid) {
        let html = await this.httpGet('http://wechat.v2.traceint.com/index.php/reserve/layoutApi/action=settings_seat_cls&libid=' + roomid + '.html');
        let seats = {};

        // 举例：此座位ID为“12,34”，座位号为“80”
        // <div class="grid_cell" data-key="12,34"><em>80</em></div>
        // 使用粗劣的正则表达式，大致匹配出它们的对应关系
        let divs = html.toString().matchAll(/<div[^>]+?grid_cell[^>]+?data-key="([^"]+)"[\s\S]+?<em>([0-9]+)<\/em>[\s\S]+?<\/div>/g);
        for (let div of divs)
            seats[div[2]] = div[1];
        return seats;
    }

    async cancel() {
        let data = await this.httpPost('https://wechat.v2.traceint.com/index.php/reserve/token.html', 'type=cancle');
        if (data['code'] != 0)
            return {
                success: false,
                msg: data['msg']
            };
        let token = data['msg'];
        await this.httpGet('http://wechat.v2.traceint.com/index.php/cancle/index?t=' + token);
        if (await this.status() == Status.IDLE)
            return {
                success: true,
                msg: null
            };
        else
            return {
                success: false,
                msg: null
            };
    }

    async reserve(roomid, seatno) {
        let seats = await this.getSeats(roomid);
        if (!seats)
            return {
                success: false,
                msg: "无此场馆",
                response: null
            };

        let seatid = seats[seatno]
        if (!seatid)
            return {
                success: false,
                msg: "无此座位",
                response: null
            };

        // 此处为服务器脚本提供一个隔离的沙箱环境
        // 为保证在异步操作中，返回值能够被成功接收，此处预先定义一个空的resolve函数
        let resolve = () => {};
        const vm_context = {
            AJAX_URL: "https://wechat.v2.traceint.com/index.php/reserve/get/",
            T: {
                ajax_get: async (url, callback) => {
                    let response = await this.httpGet(url)
                    resolve({
                        success: response['code'] == 0,
                        msg: response['msg'],
                        response: response
                    });
                }
            }
        };

        // 在指定房间的网页中，寻找reserve_seat所在的js文件
        let html = await this.httpGet("http://wechat.v2.traceint.com/index.php/reserve/layout/libid=" + roomid + ".html");
        let regexp = /https?:\/\/[!-~]+\/[0-9a-zA-Z]+\.js/g;
        let m = false, reserve_seat = null;
        while (m = regexp.exec(html)) {
            let jsUrl = m.toString()
            let jsContent = await this.httpGet(jsUrl);

            // js文件特征：内容含有“reserve_seat”、“T.ajax_get”
            if (jsContent.search("reserve_seat") != -1 && jsContent.search("T.ajax_get") != -1) {
                // 在虚拟机中执行js文件，并返回reserve_seat函数
                reserve_seat = this._reserve_seat_func(jsContent, vm_context);
            }
        }

        if (typeof reserve_seat != 'function')
            return {
                success: false,
                msg: "找不到预定函数，可能场馆暂未开放。",
                response: null
            };

        // 将真正的resolve函数赋值至作用域，执行reserve_seat
        return await new Promise(function (r, reject) {
            resolve = r;
            reserve_seat(roomid, seatid);
        });
    }

    _reserve_seat_func(script, vm_context) {
        const vm2_vm = new vm2.VM({
            timeout: 1000,
            sandbox: vm_context
        });
        vm2_vm.run(script);
        return vm2_vm.run(`global.reserve_seat`);
    }
};


/*
    用户门面
*/
const LibUser = class {
    constructor(sessid) {
        this.user = new User(sessid);
        this.autoCancelTimer = null;
    }

    async init() {
        let name = await this.user.name();
        if (!name) {
            throw "会话已过期";
        }
        console.log("欢迎 " + name);
    }

    async status() {
        let status_text;
        switch (await this.user.status()) {
            case Status.IDLE:
                status_text = '空闲';
                break;
            case Status.RESERVED:
                status_text = '已预定';
                break;
            case Status.STUDYING:
                status_text = '学习中';
                break;
        }
        console.log("您当前的状态是: " + status_text);
    }

    async reserve(roomid, seatno) {
        let ret = await this.user.reserve(roomid, seatno);
        if (ret['success']) {
            console.log("座位预定成功！");
        } else {
            console.log("座位预定失败，原因是: " + ret['msg']);
        }
    }

    async cancel() {
        let ret = await this.user.cancel();
        if (ret['success']) {
            console.log("退座成功！");
        } else {
            console.log("退座失败，请重试！");
        }
    }

    async countdown() {
        let cd = await this.user.countdown();
        console.log("您需要在 " + ~~(cd/60) + "分" + cd%60 + "秒 内到场验证。");
    }

    // minSec: 小于此值触发自动退座（如已开启）
    // intervalSec: 剩余时间更新间隔
    async autoCancel(enable=true, minSec=120, intervalSec=30) {
        if (enable && !this.autoCancelTimer) {
            if (await this.user.status() != Status.RESERVED) {
                console.log("您不处于待验证状态，自动退座已取消。");
                return;
            }
            this.autoCancelTimer = setInterval(async () => {
                try {
                    let cd = await this.user.countdown();
                    if (cd > 0) {
                        console.log("您需要在 " + ~~(cd/60) + "分" + cd%60 + "秒 内到场验证。");
                    }
                    
                    if (cd > 0 && cd <= minSec) {
                        console.log("已达到保护时间，正在自动退座...");
                        await this.cancel().catch(err => console.error(err.stack));

                    } else if (cd < 0 && await this.user.status() != Status.RESERVED) {
                        console.log("您已不再处于待验证状态，自动退座任务结束。");

                        clearInterval(this.autoCancelTimer);
                        this.autoCancelTimer = null;
                    }
                } catch(err) {
                    console.error(err.stack);
                }
            }, intervalSec * 1000);
            
        } else if (!enable && this.autoCancelTimer) {
            clearInterval(this.autoCancelTimer);
            this.autoCancelTimer = null;
        }
    }

    cronReserve(roomid, seatno, hour, minute, second, autoCancel=false) {
        console.log(`将在每日的 ${hour}:${minute}:${second} 时预定 ${roomid} 号房间的 ${seatno} 号座位。`);
        let libuser = this;
        new cron.CronJob(
            `${second} ${minute} ${hour} * * *`,
            async function () {
                const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                let attemps = 10;
                let success = false;
                while (!success && attemps > 0) {
                    attemps--;
                    let ret = await libuser.user.reserve(roomid, seatno).catch(err => console.error(err.stack));
                    let reason = ret ? ret['msg'] : false;
                    success = ret ? ret['success'] : false;
                    if (success) {
                        console.log("座位预定成功！");
                    } else {
                        console.log("座位预定失败，原因是: " + reason);
                    }
                    await sleep(200);
                }
                if (autoCancel) {
                    libuser.autoCancel();
                }
            },
            null,
            true,
            process.env.TZ
        );
    }
};


/*
    主函数
*/
(async () => {
    if (process.argv.length < 3) {
        console.log("Usage: node GoLib.js config.json");
        process.exit(0);
    }
    let conf = JSON.parse(fs.readFileSync(process.argv[2]));

    let sessid = conf['sessid'];
    let timearr = conf['time'].split(":");

    let user = new LibUser(sessid);
    await user.init();
    user.cronReserve(conf['room_id'], conf['seat_no'], hour=timearr[0], minute=timearr[1], second=timearr[2], autoCancel=true);

})().catch(err => {
    console.error(err.stack);
});
