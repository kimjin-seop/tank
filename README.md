# 스코치드 어스 포에버

턴제 탱크 포격 대전 웹 게임. 지형을 파괴하며 각도·파워를 조절해 상대를 쓰러뜨린다. (Node 20+, 의존성 `ws`만, HTTP + WebSocket `/ws` 같은 포트)

## 로컬 실행

```bash
npm install
npm start          # http://localhost:3000 (PORT, HOST 환경변수로 변경)
```

## 테스트

```bash
npm test
```

## 서버 배포 (pm2 + nginx)

- 도메인: tank.oddplay.kr, 앱 포트 **3200** (같은 서버의 liero가 3000을 사용하므로 충돌 주의)
- 방/세션이 메모리에 있어 프로세스는 반드시 1개(instances: 1)이며, 재시작하면 진행 중인 게임이 사라진다.

```bash
# 1) 리포 clone 및 의존성
git clone <저장소 URL> /data/www/tank && cd /data/www/tank
npm ci --omit=dev

# 2) pm2 시작 (PORT 3200, HOST 127.0.0.1)
pm2 start deploy/ecosystem.config.cjs
pm2 save

# 3) nginx 사이트 등록
sudo cp deploy/nginx-tank.oddplay.kr.conf /etc/nginx/sites-available/tank.oddplay.kr
sudo ln -s /etc/nginx/sites-available/tank.oddplay.kr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 4) HTTPS 인증서
sudo certbot --nginx -d tank.oddplay.kr

# 5) 확인
pm2 status
curl -I https://tank.oddplay.kr
```

### 갱신

```bash
cd /data/www/tank && git pull
npm ci --omit=dev
pm2 restart scorched-earth-forever
```

## 주의

- 저장소는 비공개로 유지할 것 (`data/mtn` 원본 지형 데이터 포함).
