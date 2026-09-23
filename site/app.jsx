import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const PASSES = [
  { minutes: 1, label: 'The quick check', description: 'One piece you need to see on yourself.' },
  { minutes: 2, label: 'The comparison', description: 'A little time to switch between two favorites.' },
  { minutes: 5, label: 'The decision', description: 'Room to explore your shortlist.' },
  { minutes: 10, label: 'The deep dive', description: 'For the cart you keep coming back to.' },
];
const MAX_ITEMS = 12;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function imageFromDrop(event) {
  const file = [...event.dataTransfer.files].find(item => IMAGE_TYPES.has(item.type));
  if (file) return { file };
  const html = event.dataTransfer.getData('text/html');
  const fromHtml = html ? new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src') : null;
  const uri = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
  const candidate = fromHtml || uri?.split('\n').find(line => !line.startsWith('#'))?.trim();
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:') return { url: url.href };
  } catch { /* Invalid drag payload. */ }
  return null;
}

function CompareBoard({ items }) {
  const [firstId, setFirstId] = useState('');
  const [secondId, setSecondId] = useState('');
  const first = items.find(item => item.id === firstId) || items[0];
  const second = items.find(item => item.id === secondId && item.id !== first?.id)
    || items.find(item => item.id !== first?.id);
  const choices = [first, second];

  return <section className="compare-section wrap" aria-labelledby="compare-title">
    <div className="compare-heading"><div><span className="kicker">THE CARTROOM WORKBENCH</span><h2 id="compare-title">A or B? Put them next to each other.</h2></div><p>Add garment images in the showroom below. This board helps you compare the products before the live fitting room is available.</p></div>
    <div className="compare-board">{choices.map((item, index) => <div className="compare-slot" key={index}>
      <div className="slot-top"><span className="slot-letter">{index === 0 ? 'A' : 'B'}</span><label htmlFor={`compare-${index}`}>{index === 0 ? 'FIRST PICK' : 'THE CONTENDER'}</label></div>
      <div className="slot-image">{item ? <img src={item.src} alt={item.name} /> : <div className="slot-empty"><span>＋</span><strong>{index === 0 ? 'Your first item' : 'Add one more item'}</strong><small>Use a real product image from your cart</small></div>}</div>
      <select id={`compare-${index}`} value={item?.id || ''} disabled={!items.length} onChange={event => index === 0 ? setFirstId(event.target.value) : setSecondId(event.target.value)} aria-label={`Choose garment ${index === 0 ? 'A' : 'B'}`}>
        {!item && <option value="">No item yet</option>}
        {items.filter(candidate => index === 0 || candidate.id !== first?.id).map((candidate, choiceIndex) => <option key={candidate.id} value={candidate.id}>{candidate.name || `Look ${choiceIndex + 1}`}</option>)}
      </select>
    </div>)}</div>
    <div className="compare-bottom"><span>{second ? 'Two items ready to compare' : 'Add two items to make the decision real'}</span><a href="#showroom">Add items to compare ↗</a></div>
  </section>;
}

function App() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedPass, setSelectedPass] = useState(5);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [resolving, setResolving] = useState(false);
  const inputRef = useRef(null);
  const urlsRef = useRef(new Set());

  useEffect(() => () => { for (const url of urlsRef.current) URL.revokeObjectURL(url); }, []);
  const addItem = async source => {
    if (items.length >= MAX_ITEMS) { setError(`Your showroom holds ${MAX_ITEMS} pieces. Remove one to add another.`); return; }
    if (!source) { setError('Drag a clothing image or product link, upload a file, or paste a link.'); return; }
    if (source.file && (!IMAGE_TYPES.has(source.file.type) || source.file.size > 4 * 1024 * 1024)) {
      setError('Use a JPG, PNG or WebP under 4 MB.'); return;
    }
    let src;
    if (source.file) src = URL.createObjectURL(source.file);
    else {
      setResolving(true);
      try {
        const response = await fetch('/api/product-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: source.url }) });
        const body = await response.json();
        if (!response.ok) throw Error(body.error || 'Could not read this product image.');
        src = body.image;
      } catch (reason) { setError(reason.message || 'Could not read this product image.'); setResolving(false); return; }
      setResolving(false);
    }
    if (source.file) urlsRef.current.add(src);
    const item = { id: crypto.randomUUID(), src, name: source.file?.name?.replace(/\.[^.]+$/, '') || 'From your cart', source: source.file ? 'upload' : 'link' };
    setItems(previous => [...previous, item]);
    setSelectedId(item.id);
    setError(''); setLink('');
  };
  const removeItem = id => {
    const item = items.find(value => value.id === id);
    if (item?.source === 'upload') { URL.revokeObjectURL(item.src); urlsRef.current.delete(item.src); }
    setItems(previous => previous.filter(value => value.id !== id));
    if (selectedId === id) setSelectedId(items.find(value => value.id !== id)?.id || null);
  };
  const addLink = event => {
    event.preventDefault();
    try {
      const url = new URL(link.trim());
      if (url.protocol !== 'https:') throw Error();
      addItem({ url: url.href });
    } catch { setError('Paste a public HTTPS product-page or image URL.'); }
  };
  const selected = items.find(item => item.id === selectedId);
  const currentPass = PASSES.find(pass => pass.minutes === selectedPass);

  return <>
    <header className="topbar wrap"><a className="brand" href="#top" aria-label="Cartroom home">cartroom<span>✳</span></a><nav aria-label="Main navigation"><a href="#how">How it works</a><a href="#showroom">Showroom</a><a href="#passes">Time passes</a></nav><a className="nav-cta" href="#showroom">Start your shortlist <span>↗</span></a></header>
    <main id="top">
      <section className="hero wrap"><div className="hero-copy"><div className="eyebrow"><span className="pulse" /> YOUR CART, WITH A SECOND OPINION</div><h1>Two pricey shirts.<br /><em>One to keep.</em></h1><p>Choose between the clothes you're about to buy. See each one on you, compare the looks, and spend on the piece you actually want.</p><div className="hero-actions"><a className="button primary" href="#showroom">Compare two items <span>↗</span></a><a className="text-link" href="#how">See how it works ↓</a></div><div className="hero-note"><span className="tiny-star">✳</span> Add your pieces first. Choose a time pass when you’re ready.</div></div><div className="hero-art" aria-label="Illustration of comparing two garments"><div className="art-label">THE DECISION, SIDE BY SIDE</div><div className="art-window"><div className="art-card card-one"><div className="sweater sweater-sage"><i /></div><span>A / THE FIRST PICK</span></div><div className="art-card card-two"><div className="sweater sweater-cream"><i /></div><span>B / THE CONTENDER</span></div></div><div className="art-stamp">KEEP<br />ONE.</div></div></section>
      <CompareBoard items={items} />
      <div className="marquee"><span>LESS GUESSWORK</span><b>✳</b><span>MORE CERTAINTY</span><b>✳</b><span>BUY WHAT YOU ACTUALLY WANT</span><b>✳</b><span>LESS GUESSWORK</span></div>
      <section className="section wrap" id="how"><div className="section-heading"><span className="kicker">01 / THE IDEA</span><h2>That second look<br />could save you the first purchase.</h2><p>Not another wishlist. A place to compare what’s already in your cart, on you, before checkout.</p></div><div className="steps"><article><span>01</span><h3>Bring your maybes</h3><p>Drag clothing images or public product links from another tab, upload files, or paste a link.</p></article><article><span>02</span><h3>Pick your moment</h3><p>Choose a time pass once your shortlist is ready. No camera access or AI time is used while you collect items.</p></article><article><span>03</span><h3>See, switch, decide</h3><p>Try one piece, switch to another, and decide what deserves a place in your cart.</p></article></div></section>
      <section className="showroom-section" id="showroom"><div className="wrap"><div className="section-heading compact"><span className="kicker">02 / YOUR SPACE</span><h2>Build your showroom.</h2><p>Drop in the pieces you’re deciding between. Your gallery stays on this device while this page is open.</p></div><div className="showroom"><div className="gallery-pane"><div className="pane-top"><strong>YOUR SHORTLIST</strong><span>{items.length} / {MAX_ITEMS} PIECES</span></div><div className={`dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); addItem(imageFromDrop(event)); }}><span className="drop-icon">＋</span><strong>Drop a product image or link from another tab</strong><span>or <button type="button" className="inline-button" onClick={() => inputRef.current?.click()}>choose a file</button> from your device</span><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => { [...event.target.files].forEach(file => addItem({file})); event.target.value = ''; }} /></div><form className="link-form" onSubmit={addLink}><label htmlFor="image-link">Have a product or image link?</label><div><input id="image-link" value={link} onChange={event => setLink(event.target.value)} placeholder="https://store.com/product-page" /><button type="submit" disabled={resolving}>Add to gallery ↗</button></div></form>{resolving && <p className="form-status" role="status">Finding the product image…</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="item-grid">{items.map((item, index) => <div className={`item ${item.id === selectedId ? 'chosen' : ''}`} key={item.id}><button type="button" className="item-select" aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)}><img src={item.src} alt={item.name} onError={event => { event.currentTarget.style.opacity = '.25'; }} /><span>LOOK {String(index + 1).padStart(2, '0')}</span></button><button type="button" className="remove" aria-label={`Remove ${item.name}`} onClick={() => removeItem(item.id)}>×</button></div>)}</div></div><div className="preview-pane"><div className="pane-top"><strong>THE PREVIEW</strong><span>{selected ? 'PIECE SELECTED' : 'WAITING FOR YOUR FIRST PIECE'}</span></div><div className="preview-frame">{selected ? <><img src={selected.src} alt={selected.name} /><span className="preview-caption">Selected for your try-on</span></> : <div className="preview-empty"><span>✳</span><h3>Start with the one<br />you’re unsure about.</h3><p>Your chosen piece will appear here.</p></div>}</div><div className="preview-foot"><span>LIVE CAMERA TRY-ON</span><span className="pill">Available after checkout</span></div></div></div></div></section>
      <section className="section wrap" id="proof"><div className="section-heading compact"><span className="kicker">03 / SEE THE IDEA</span><h2>Watch it in action.</h2><p>The reels that started the conversation. Real examples of why a second look can change your mind.</p></div><div className="reel-grid">{[1,2,3].map(number => <div className="reel-placeholder" key={number}><span>REEL {String(number).padStart(2,'0')}</span><strong>Your video<br />goes here</strong><small>Add your Instagram reel URL to publish this story.</small></div>)}</div></section>
      <section className="pricing-section" id="passes"><div className="wrap"><div className="section-heading compact"><span className="kicker">04 / MAKE THE CALL</span><h2>Time to decide.</h2><p>Choose how long you want in the live fitting room. Your gallery is free to build; AI time starts only after you connect.</p></div><div className="pass-grid">{PASSES.map(pass => <button type="button" className={`pass-card ${pass.minutes === selectedPass ? 'selected' : ''}`} key={pass.minutes} onClick={() => setSelectedPass(pass.minutes)} aria-pressed={pass.minutes === selectedPass}><span>{pass.minutes < 10 ? `0${pass.minutes}` : pass.minutes} MIN</span><strong>{pass.label}</strong><small>{pass.description}</small><i>{pass.minutes === selectedPass ? '✓ Selected' : 'Select pass ↗'}</i></button>)}</div><div className="checkout-bar"><div><strong>{currentPass.minutes}-minute showroom pass</strong><span>Prices and checkout are not live yet. No payment will be taken.</span></div><button type="button" disabled title="Checkout is not configured yet">Checkout coming soon ↗</button></div><p className="pricing-note">A paid pass will only begin when a live session is available. AI previews show appearance, not guaranteed size or fit.</p></div></section>
      <section className="final-cta wrap"><span className="kicker">THE CART CAN WAIT A MINUTE</span><h2>Buy the thing you’ll<br /><em>actually want to keep.</em></h2><a className="button primary" href="#showroom">Build your shortlist <span>↗</span></a></section>
    </main><footer className="footer wrap"><a className="brand" href="#top">cartroom<span>✳</span></a><p>A clearer look before you buy. AI previews can make mistakes and do not predict physical fit.</p><a href="/classic">Open existing demo ↗</a></footer>
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
