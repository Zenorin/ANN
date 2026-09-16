(function () {
  const e = React.createElement;
  window.next = { version: '14.2.0', router: { pathname: '/', asPath: '/', query: {} } };
  window.dataLayer = [];
  window.ChannelIO = function () {};
  function Header() {
    return e('header', { className: 'site-header' },
      e('a', { className: 'logo', href: '/' }, 'MadeMate'),
      e('nav', null, e('a', { href: '/about' }, '소개'), e('a', { href: '/contact' }, '문의'), e('a', { href: 'https://instagram.com/mademate', target: '_blank', rel: 'noopener' }, 'Instagram')));
  }
  function Hero({ onCta }) {
    return e('section', { className: 'hero', id: 'hero' },
      e('div', null,
        e('h1', null, 'AI로 만드는 나만의 굿즈'),
        e('p', { className: 'muted' }, '텍스트 한 줄로 포스터, 티셔츠, 스티커를 만들어 보세요.'),
        e('button', { className: 'btn', onClick: onCta, onMouseEnter: () => {} }, e(Icon), '지금 시작하기'),
        ' ',
        e('a', { className: 'btn secondary', href: '/about' }, '더 알아보기')),
      e('img', { src: '/_next/image?url=%2Fimg%2Fhero.png&w=640&q=75', alt: '히어로 이미지', width: 640, height: 360 }));
  }
  function Icon() {
    return e('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }, e('path', { d: 'M5 12h14M12 5l7 7-7 7' }));
  }
  const ProductCard = React.memo(function ProductCard({ product, onAdd }) {
    return e('article', { className: 'card' },
      e('img', { src: `/img/product${product.id}.png`, alt: product.name, loading: 'lazy' }),
      e('div', { className: 'body' },
        e('h3', null, e('span', { className: 'badge' }), product.name),
        e('div', { className: 'price' }, product.price.toLocaleString('ko-KR') + '원'),
        e('button', { className: 'btn', onClick: () => onAdd(product) }, '장바구니 담기')));
  });
  function Products({ products, onAdd }) {
    return e('section', { className: 'products', id: 'products', 'aria-label': '상품 목록' },
      e('h2', null, '인기 상품'),
      e('div', { className: 'grid' }, products.map((p) => e(ProductCard, { key: p.id, product: p, onAdd }))));
  }
  function Sidebar() {
    return e('div', { className: 'with-sidebar' },
      e('aside', { className: 'sidebar' }, e('h4', null, '카테고리'), e('ul', null, e('li', null, e('a', { href: '/products/1' }, '포스터')), e('li', null, e('a', { href: '/products/2' }, '티셔츠')))),
      e('div', { className: 'long' }, e('h2', null, '긴 콘텐츠 영역'), e('p', { className: 'pulse' }, '스크롤 테스트를 위한 긴 섹션입니다.'), e('div', { className: 'css-inline1' }, 'emotion 스타일')));
  }
  function Newsletter() {
    const [email, setEmail] = React.useState('');
    return e('section', { className: 'newsletter' },
      e('h2', null, '뉴스레터 구독'),
      e('form', { action: '/api/subscribe', method: 'post', onSubmit: (ev) => ev.preventDefault() },
        e('label', { htmlFor: 'email' }, '이메일 '),
        e('input', { id: 'email', name: 'email', type: 'email', placeholder: 'you@example.com', required: true, value: email, onChange: (ev) => setEmail(ev.target.value) }),
        ' ',
        e('button', { className: 'btn', type: 'submit' }, '구독')));
  }
  function Footer() {
    return e('footer', { className: 'site-footer' }, e('p', null, '© 2026 MadeMate Test. ', e('a', { href: 'mailto:hello@example.com' }, 'hello@example.com')), e('nav', { 'aria-label': '푸터' }, e('a', { href: '/about' }, '소개'), ' · ', e('a', { href: '/contact' }, '문의'), ' · ', e('a', { href: '/#hero' }, '맨 위로')));
  }
  function App() {
    const [products, setProducts] = React.useState(window.__NEXT_DATA__ ? JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps.products : []);
    const [cart, setCart] = React.useState([]);
    React.useEffect(() => {
      fetch('/api/products').then((r) => r.json()).then((d) => setProducts(d.products));
      const xhr = new XMLHttpRequest(); xhr.open('GET', '/api/config'); xhr.send();
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret-token' }, body: JSON.stringify({ event: 'view' }) });
    }, []);
    return e(React.Fragment, null,
      e(Header),
      e('main', null,
        e(Hero, { onCta: () => setCart((c) => c.concat({ id: 0 })) }),
        e(Products, { products, onAdd: (p) => setCart((c) => c.concat(p)) }),
        e(Sidebar),
        e(Newsletter)),
      e(Footer),
      e('div', { className: 'cta-bar' }, `장바구니 ${cart.length}개 · 오늘만 20% 할인`));
  }
  ReactDOM.createRoot(document.getElementById('__next')).render(e(App));
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('auth_token', 'super-secret-value');
  document.cookie = 'visited=1; path=/';
})();
