# GoLib.js

GoLib.js **不是** Go语言的库（笑）。

GoLib.js 是一个能够每日定时自动预定图书馆座位，使用 Node.js 编写的 *我<ruby>去<rp>(</rp><rt>Go</rt><rp>)</rp></ruby><ruby>图书馆<rp>(</rp><rt>Lib</rt><rp>)</rp></ruby>* <ruby>JavaScript<rp>(</rp><rt>.js</rt><rp>)</rp></ruby>脚本。


## 说明

本开源脚本仅供学习参考使用。

GoLib.js 仅适配于 *我去图书馆 v2* 版本。**2021年暑期，*我去图书馆* 已经更新版本。**


## 特性

1. **安心。** 每日自动定时预约图书馆座位，无需六点早起；
2. **安全。** 超出打卡有效时间自动退座，不用担心进小黑屋；
3. **持久。** 自动维持 Session，保持会话有效，无需每次抓包Cookie；
4. **无害。** 不同于其他脚本，GoLib.js 使用先进的 [vm2](https://github.com/patriksimek/vm2) 沙盒技术，解决服务端混淆 JS 的验证机制，防止远程有害代码损害计算机；
5. **简洁。** 没有过多的外部依赖，有 NodeJS 和 npm 就足够了。


## 使用方法

1. 安装依赖。
```bash
npm install --dependencies
```

2. 创建配置文件 `config.json`。详细见下文。

3. 运行。
```bash
node GoLib.js config.json
```


## 配置文件说明

配置文件的内容如下所示：
```json
{
    "sessid": "d41d8cd98f00b204e9800998ecf8427ed41d8cd98f00b204",
    "room_id": "12",
    "seat_no": "34",
    "time": "06:00:00"
}
```

 - `"sessid"` 对应值为Cookie中`wechatSESS_ID`的值，需要通过抓包获得；
 - `"room_id"` 对应值为图书馆阅览室编号，可以通过选座时URL中的`libid`获得；
 - `"room_id"` 对应值为座位号；
 - `"time"` 对应值为每日定时预约时间，24小时制。


## DEMO

```
$ node GoLib.js config.json
欢迎 GoLib.js！
将在每日的 6:0:0 时预定 12 号房间的 34 号座位。
座位预定成功！
您需要在 150分0秒 内到场验证。
您需要在 149分30秒 内到场验证。
...
您已不再处于待验证状态，自动退座任务结束。
```
