@echo off
title body-watcher google tunnel
rem 登录自启:本文件放在 shell:startup 启动文件夹里(schtasks 的 ONLOGON 触发器要管理员,这里不用)
rem 移除自启:删掉启动文件夹里的这个文件即可
"D:\CUS\nodejs\node.exe" "D:\project\body-watcher\scripts\google-tunnel.mjs"
