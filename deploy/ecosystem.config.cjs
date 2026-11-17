// pm2 설정: pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'scorched-earth-forever',
    script: 'server/index.js',
    cwd: __dirname + '/..',
    instances: 1,            // 방/세션을 메모리에 두므로 반드시 1개
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', PORT: 3200, HOST: '127.0.0.1' },
    max_memory_restart: '400M',
    time: true,
  }],
};
