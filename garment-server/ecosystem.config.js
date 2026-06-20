// pm2 ecosystem — production
// 锁 cwd: __dirname (db.js:5 写死 path.join(__dirname, 'data.sqlite'),
//                  跑在不同 cwd 会让 DB 写到错地方)
// env_file 指向 /opt/garment/env/garment.env (不在 git 里, chmod 600)
// 仅用于云端生产部署,本地 dev 仍用 `node server.js` 或 start-dev.bat
// [2026-06-20 fix#后端-P3-8] log rotation: 部署后运行
//   pm2 install pm2-logrotate
//   pm2 set pm2-logrotate:max_size 50M
//   pm2 set pm2-logrotate:retain 14
//   pm2 set pm2-logrotate:compress true
//   (pm2-logrotate 自动接管 error_file/out_file,按 size/天数切割 + gzip)

module.exports = {
  apps: [
    {
      name: 'garment-server',
      cwd: __dirname,
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=512',
      autorestart: true,
      max_memory_restart: '450M',
      kill_timeout: 10000,
      wait_ready: false,
      listen_timeout: 10000,

      env_file: '/opt/garment/env/garment.env',

      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },

      error_file: '/opt/garment/logs/pm2-error.log',
      out_file:   '/opt/garment/logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,

      // 凌晨 3:30 轻微重启清内存 (避免 long-running 内存爬升)
      cron_restart: '30 3 * * *',
    },
  ],
};
