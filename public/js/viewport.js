// 실제 보이는 높이를 CSS 변수 --vvh 로 유지한다.
// 카카오톡 등 인앱 브라우저는 하단 툴바가 100vh/100% 영역을 덮어 하단 버튼이 가려지므로 visualViewport 높이를 기준으로 화면을 맞춘다.
// 미지원·스크립트 실패 시 CSS 쪽 폴백(100dvh → 100vh)이 쓰인다.
export function initViewportHeight() {
  const root = document.documentElement, vv = window.visualViewport;
  let raf = 0, timer = 0, last = '';
  const apply = () => {
    raf = 0;
    // 핀치 확대 중(로비·대기실은 확대 허용)에는 보이는 영역이 줄어든 것이 아니므로 직전 값 유지
    if (vv && vv.scale > 1.01) return;
    let h = window.innerHeight;
    if (vv && vv.height > 0) h = Math.min(h || vv.height, vv.height);
    if (!(h > 0)) return;
    const v = Math.round(h) + 'px';
    if (v !== last) { last = v; root.style.setProperty('--vvh', v); }
  };
  // 스로틀: 프레임당 1회. 회전 직후 일부 브라우저는 크기를 늦게 반영하므로 잠시 뒤 한 번 더 확인
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply);
    clearTimeout(timer); timer = setTimeout(apply, 300);
  };
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.addEventListener('pageshow', schedule, { passive: true });
  if (vv) { vv.addEventListener('resize', schedule, { passive: true }); vv.addEventListener('scroll', schedule, { passive: true }); }
  apply();
}
