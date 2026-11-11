import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import {
  db,
  configured,
  categories,
  Gift,
  action,
  safeUrl,
  upload,
} from "./api";
import "./style.css";
function Ribbon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`ribbon ${className}`}
      viewBox="0 0 160 142"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M79 61C60 27 22 16 18 36c-4 21 30 37 61 25Z" />
        <path d="M83 61c12-33 48-45 55-27 9 23-22 38-55 27Z" />
        <path d="M78 62c-7-13-13-7-11 0 1 6 13 9 19 5 8-6 2-15-5-9" />
        <path d="M74 68c-4 23-18 44-32 58l-1-20-19 5c20-16 36-31 48-45" />
        <path d="M84 68c3 19 13 39 30 58l-1-23 23 4c-24-15-39-25-48-42" />
        <path
          d="M26 34c14-1 31 12 45 22m61-20c-9 1-27 12-42 21"
          opacity=".55"
        />
      </g>
    </svg>
  );
}
function App() {
  const [notice, setNotice] = useState("");
  return (
    <HashRouter>
      <div className="shell">
        <header>
          <Link
            className="brand"
            to="/"
            aria-label="Sonya’s wishlist — главная"
          >
            <span className="brand-monogram">
              s<wbr />
              w.
            </span>
            <span className="brand-caption">
              SONYA’S
              <br />
              LITTLE ARCHIVE
            </span>
          </Link>
          <span className="micro">a few things, a lot of joy</span>
          <Link className="admin-link" to="/admin">
            for sonya ↗
          </Link>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Collection notify={setNotice} />} />
            <Route
              path="/gift/:id"
              element={<Collection notify={setNotice} />}
            />
            <Route path="/cancel" element={<Cancel notify={setNotice} />} />
            <Route path="/admin" element={<Admin notify={setNotice} />} />
            <Route path="/setup" element={<SetupAdmin notify={setNotice} />} />
            <Route
              path="*"
              element={
                <p>
                  Страница не найдена. <Link to="/">В коллекцию</Link>
                </p>
              }
            />
          </Routes>
        </main>
        <footer>
          <span className="footer-signature">
            yours, Sonya
            <span className="signature-underline" />
          </span>
          <span>made with love & a little bit of obsession.</span>
          <span>SONYA’S WISHLIST © {new Date().getFullYear()}</span>
        </footer>
      </div>
      {notice && (
        <div role="status" className="toast" onClick={() => setNotice("")}>
          {notice}
          <button
            aria-label="Закрыть уведомление"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
    </HashRouter>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      aria-label={title}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal">
        <button className="close" aria-label="Закрыть окно" onClick={close}>
          ×
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
function Collection({ notify }: { notify: (s: string) => void }) {
  const [gifts, setGifts] = useState<Gift[]>([]),
    [loading, setLoading] = useState(configured),
    [error, setError] = useState(""),
    [category, setCategory] = useState("all"),
    [sort, setSort] = useState("date"),
    [suggest, setSuggest] = useState(false),
    [reserve, setReserve] = useState<Gift | null>(null),
    [cancelLink, setCancelLink] = useState(""),
    [busy, setBusy] = useState(false);
  const { id } = useParams();
  const navigate = useNavigate();
  const load = async () => {
    if (!configured) return;
    const { data, error } = await db
      .from("gifts")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) setError("Не удалось загрузить коллекцию. Попробуйте ещё раз.");
    else {
      setGifts(data || []);
      setError("");
    }
  };
  useEffect(() => {
    void load();
    if (!configured) return;
    const channel = db
      .channel("gifts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gifts" },
        () => void load(),
      )
      .subscribe();
    const timer = setInterval(() => void load(), 15000);
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => {
      void db.removeChannel(channel);
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);
  const selected = gifts.find((g) => g.id === id);
  const visible = gifts
    .filter((g) => category === "all" || g.category === category)
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : sort === "price"
          ? (a.price ?? Infinity) - (b.price ?? Infinity)
          : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  async function book() {
    if (!reserve) return;
    setBusy(true);
    try {
      const token = crypto.randomUUID() + crypto.randomUUID();
      await action("reserve", { gift_id: reserve.id, token });
      const link = new URL(location.href);
      link.hash = `/cancel?gift=${reserve.id}&token=${encodeURIComponent(token)}`;
      setCancelLink(link.href);
      setReserve(null);
      await load();
    } catch (e) {
      notify((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="hero" aria-labelledby="wishlist-heading">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-line" /> a little collection of things i love
          </div>
          <h1 id="wishlist-heading">
            <span className="hero-first">sonya’s</span>
            <span className="hero-second">
              wishlist<span className="red-period">.</span>
            </span>
          </h1>
          <div className="hero-bottom">
            <p>
              things that would make me
              <br className="desktop-break" /> very happy
            </p>
            <span className="handwritten">
              little things,
              <br />
              big happiness.
            </span>
          </div>
        </div>
        <aside className="letter-scene" aria-label="Послание друзьям">
          <span className="scene-label micro">PERSONAL ARCHIVE / VOL. 01</span>
          <div className="letter-shadow" aria-hidden="true" />
          <div className="friend-letter">
            <span className="paperclip" aria-hidden="true" />
            <div className="letter-top">
              <span className="micro">TO: MY FAVOURITE PEOPLE</span>
              <span className="letter-number">01 / ∞</span>
            </div>
            <Ribbon className="letter-ribbon" />
            <p className="letter-title">
              a small note <br />
              for you
            </p>
            <p className="letter-body">
              Здесь всё, чему я буду рада.
              <br />
              Выберите что-то по душе —<br />а остальное пусть будет сюрпризом.
            </p>
            <div className="letter-signature">
              <span>with love,</span>
              <b>Sonya</b>
            </div>
            <div className="letter-bottom">
              <span className="letter-line" />
              <span className="micro">GOOD THINGS INSIDE</span>
              <span className="letter-line" />
            </div>
          </div>
          <span className="scene-note handwritten">no occasion needed</span>
        </aside>
      </section>
      <section className="collection">
        <div className="section-heading">
          <div className="collection-heading">
            <span className="micro collection-kicker">CURATED BY SONYA</span>
            <h2>
              the good things<span className="red-period">.</span>
              <span
                className="count"
                aria-label={`${gifts.length} подарков в коллекции`}
              >
                {String(gifts.length).padStart(2, "0")}
              </span>
            </h2>
          </div>
          <button
            className="suggest"
            onClick={() => setSuggest(true)}
            disabled={!configured}
          >
            + suggest a gift
          </button>
        </div>
        <div className="toolbar">
          <div className="filters" role="group" aria-label="Категории">
            {["all", ...categories].map((c) => (
              <button
                key={c}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="sort">
            sort by{" "}
            <select
              aria-label="Сортировка"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="date">newest first</option>
              <option value="price">price ↑</option>
              <option value="name">name A–Z</option>
            </select>
          </label>
        </div>
        {!configured ? (
          <div className="empty">
            <Ribbon className="empty-ribbon" />
            <h2>A little space for lovely things.</h2>
            <p>
              Коллекция готова к наполнению.
              <br />
              Подключите Supabase по инструкции README, чтобы добавлять и
              бронировать подарки.
            </p>
            <Link to="/admin">Открыть управление ↗</Link>
          </div>
        ) : loading ? (
          <p className="empty" role="status">
            Загружаем маленькие желания…
          </p>
        ) : error ? (
          <div className="empty" role="alert">
            {error}
            <button onClick={() => void load()}>Повторить</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <Ribbon className="empty-ribbon" />
            <h2>
              {gifts.length
                ? "Nothing here. Yet."
                : "The beginning of a lovely collection."}
            </h2>
            <p>
              {gifts.length
                ? "В этой категории пока нет подарков."
                : "Скоро здесь появятся первые желания."}
            </p>
          </div>
        ) : (
          <div className="grid">
            {visible.map((g, i) => (
              <article
                className="card"
                key={g.id}
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <button
                  className="photo"
                  onClick={() => navigate("/gift/" + g.id)}
                  aria-label={"Подробнее: " + g.title}
                >
                  {g.image_url ? (
                    <img
                      src={g.image_url}
                      alt={g.title}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  ) : (
                    <span className="no-photo">a little wish</span>
                  )}
                  <span className="index">
                    N° {String(i + 1).padStart(2, "0")}
                  </span>
                  {g.reserved && <span className="reserved">reserved</span>}
                  {g.priority === "really want" && (
                    <span className="priority">really want</span>
                  )}
                </button>
                <div className="card-meta">
                  <span>{g.category}</span>
                  <span>{money(g.price)}</span>
                </div>
                <button
                  className="title-button"
                  onClick={() => navigate("/gift/" + g.id)}
                >
                  <h2>{g.title}</h2>
                </button>
                <p className="description">{g.description}</p>
                <div className="card-actions">
                  {g.shop_url ? (
                    <a
                      href={safeUrl(g.shop_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Посмотреть товар ↗
                    </a>
                  ) : (
                    <span />
                  )}
                  <button disabled={g.reserved} onClick={() => setReserve(g)}>
                    {g.reserved ? "reserved" : "Забронировать +"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="collection-end">
          <span className="end-rule" />
          <span>a few of my favourite things</span>
          <span className="end-rule" />
        </div>
      </section>
      {suggest && (
        <Modal title="A lovely idea?" close={() => setSuggest(false)}>
          <p>
            Предложите подарок. Он появится в коллекции после одобрения Сони.
          </p>
          <GiftForm
            suggestion
            onSave={async (value, captcha) => {
              await action("suggest", { gift: value, captcha });
              setSuggest(false);
              notify("Спасибо! Предложение отправлено Соне.");
            }}
          />
        </Modal>
      )}
      {id && !loading && (
        <Modal
          title={selected?.title || "Подарок не найден"}
          close={() => navigate("/")}
        >
          {selected ? (
            <>
              {selected.image_url && (
                <img
                  className="detail-image"
                  src={selected.image_url}
                  alt={selected.title}
                />
              )}
              <p className="micro">
                {selected.category} · {selected.priority} ·{" "}
                {money(selected.price)}
              </p>
              <p>{selected.description}</p>
              <div className="detail-actions">
                {selected.shop_url && (
                  <a
                    className="outline"
                    href={safeUrl(selected.shop_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Посмотреть товар ↗
                  </a>
                )}
                <button
                  className="primary"
                  disabled={selected.reserved}
                  onClick={() => {
                    setReserve(selected);
                    navigate("/");
                  }}
                >
                  {selected.reserved ? "reserved" : "Забронировать"}
                </button>
                <button onClick={() => void copy(location.href, notify)}>
                  Скопировать ссылку
                </button>
              </div>
            </>
          ) : (
            <p>Возможно, его уже удалили.</p>
          )}
        </Modal>
      )}
      {reserve && (
        <Modal
          title="Save this little wish?"
          close={() => {
            if (!busy) setReserve(null);
          }}
        >
          <p>
            Забронировать «{reserve.title}»? Другие гости увидят статус
            reserved. Имя и контакты не нужны.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void book()}
          >
            {busy ? "Сохраняем…" : "Подтвердить бронь"}
          </button>
        </Modal>
      )}
      {cancelLink && (
        <Modal title="It’s reserved for you." close={() => setCancelLink("")}>
          <p>
            Сохраните эту приватную ссылку: только с ней можно отменить бронь.
            Восстановить ссылку нельзя. Не пересылайте её другим.
          </p>
          <input
            aria-label="Приватная ссылка отмены"
            readOnly
            value={cancelLink}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="primary"
            onClick={() => void copy(cancelLink, notify)}
          >
            Скопировать ссылку отмены
          </button>
          <p className="micro">
            Соня видит только reserved — без имени и контактов.
          </p>
        </Modal>
      )}
    </>
  );
}
declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => string;
      remove: (id: string) => void;
    };
  }
}
function Captcha({ onToken }: { onToken: (s: string) => void }) {
  if (import.meta.env.VITE_TURNSTILE_SITE_KEY)
    return <TurnstileCaptcha onToken={onToken} />;
  return <ProofChallenge onToken={onToken} />;
}
function ProofChallenge({ onToken }: { onToken: (s: string) => void }) {
  const [state, setState] = useState("Проверяем защиту от спама…"),
    [attempt, setAttempt] = useState(0),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    onToken("");
    setFailed(false);
    setState("Проверяем защиту от спама…");
    void (async () => {
      try {
        const c = await action("challenge", {});
        const encoder = new TextEncoder();
        for (let solution = 0; solution <= 1048576; solution++) {
          if (stopped) return;
          const hash = new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              encoder.encode(c.nonce + ":" + solution),
            ),
          );
          if (hash[0] === 0 && hash[1] < 16) {
            onToken(JSON.stringify({ ...c, solution }));
            setState("Защита от спама готова");
            return;
          }
        }
        throw Error("Не удалось завершить проверку.");
      } catch (e) {
        if (!stopped) {
          setFailed(true);
          setState((e as Error).message);
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [attempt]);
  return (
    <div className="proof-status" role="status">
      <small>{state}</small>
      {failed && (
        <button type="button" onClick={() => setAttempt((v) => v + 1)}>
          Повторить проверку
        </button>
      )}
    </div>
  );
}
function TurnstileCaptcha({ onToken }: { onToken: (s: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!import.meta.env.VITE_TURNSTILE_SITE_KEY) return;
    let widget: string | undefined;
    let stopped = false;
    const render = () => {
      if (!stopped && ref.current && window.turnstile)
        widget = window.turnstile.render(ref.current, {
          sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
    };
    let script = document.querySelector<HTMLScriptElement>(
      "script[data-turnstile]",
    );
    if (window.turnstile) render();
    else {
      if (!script) {
        script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.dataset.turnstile = "true";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }
    return () => {
      stopped = true;
      script?.removeEventListener("load", render);
      if (widget) window.turnstile?.remove(widget);
    };
  }, []);
  return (
    <div>
      {!import.meta.env.VITE_TURNSTILE_SITE_KEY && (
        <p role="alert">
          Предложения станут доступны после настройки защиты от спама.
        </p>
      )}
      <div ref={ref} />
    </div>
  );
}
function money(price: number | null) {
  return price === null
    ? ""
    : new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: 0,
      }).format(price);
}
async function copy(value: string, notify: (s: string) => void) {
  try {
    await navigator.clipboard.writeText(value);
    notify("Ссылка скопирована.");
  } catch {
    notify("Не удалось скопировать. Выделите ссылку и скопируйте вручную.");
  }
}
function GiftForm({
  initial,
  suggestion = false,
  onSave,
}: {
  initial?: Partial<Gift>;
  suggestion?: boolean;
  onSave: (g: Partial<Gift>, captcha?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [captcha, setCaptcha] = useState(""),
    [captchaVersion, setCaptchaVersion] = useState(0);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          if (f.get("website")) throw Error("Не удалось отправить форму.");
          let image = safeUrl(String(f.get("image_url") || ""));
          const file = f.get("file") as File;
          if (file?.size) {
            if (suggestion) {
              if (
                !["image/jpeg", "image/png", "image/webp"].includes(
                  file.type,
                ) ||
                file.size > 5 * 1024 * 1024
              )
                throw Error("Фото: JPG, PNG или WebP, до 5 МБ.");
              image = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
            } else image = await upload(file);
          }
          const price = String(f.get("price") || "");
          await onSave(
            {
              title: String(f.get("title")).trim(),
              description: String(f.get("description") || "").trim(),
              image_url: image,
              shop_url: safeUrl(String(f.get("shop_url") || "")),
              price: price ? Number(price) : null,
              category: String(f.get("category") || "other"),
              priority: String(f.get("priority") || "just an idea"),
            },
            captcha,
          );
        } catch (e) {
          setError((e as Error).message);
          setCaptcha("");
          setCaptchaVersion((v) => v + 1);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Название *
        <input
          name="title"
          required
          maxLength={120}
          defaultValue={initial?.title}
        />
      </label>
      <label>
        Фото по ссылке
        <input
          name="image_url"
          type="url"
          maxLength={2048}
          defaultValue={initial?.image_url}
        />
      </label>
      <label>
        или загрузить фотографию
        <input
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
        />
        <small>JPG, PNG, WebP · до 5 МБ</small>
      </label>
      <label>
        Ссылка на магазин
        <input
          name="shop_url"
          type="url"
          maxLength={2048}
          defaultValue={initial?.shop_url}
        />
      </label>
      <label>
        Короткое описание
        <textarea
          name="description"
          maxLength={1000}
          defaultValue={initial?.description}
        />
      </label>
      {!suggestion && (
        <>
          <label>
            Цена, ₽
            <input
              name="price"
              type="number"
              min="0"
              max="100000000"
              step="0.01"
              defaultValue={initial?.price ?? ""}
            />
          </label>
          <label>
            Категория
            <select name="category" defaultValue={initial?.category || "other"}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Приоритет
            <select
              name="priority"
              defaultValue={initial?.priority || "would love"}
            >
              {["really want", "would love", "just an idea"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="honeypot" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {suggestion && <Captcha key={captchaVersion} onToken={setCaptcha} />}{" "}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy || (suggestion && !captcha)}>
        {busy
          ? "Сохраняем…"
          : suggestion
            ? "Отправить предложение"
            : "Сохранить подарок"}
      </button>
    </form>
  );
}
function SetupAdmin({ notify }: { notify: (s: string) => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const token = params.get("token");
  return (
    <section className="admin">
      <span className="micro">a key to your little archive</span>
      <h1>
        make it yours<span>.</span>
      </h1>
      <p>
        Первый вход для Сони. Задайте пароль для управления коллекцией. Личная
        ссылка используется один раз.
      </p>
      {!token ? (
        <p className="error">
          Для первого входа нужна ваша личная ссылка настройки.
        </p>
      ) : (
        <form
          className="login"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const password = String(f.get("password"));
            if (password !== f.get("confirm")) {
              setError("Пароли не совпадают.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              const { email } = await action("setup", { token, password });
              const { error } = await db.auth.signInWithPassword({
                email,
                password,
              });
              if (error)
                throw Error(
                  "Аккаунт создан. Войдите с новым паролем на странице управления.",
                );
              notify("Ваш аккаунт готов. Можно добавлять подарки.");
              navigate("/admin", { replace: true });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Ваш новый пароль
            <input
              type="password"
              name="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <small>
            Не менее 12 символов. Сохраните пароль в менеджере паролей.
          </small>
          <label>
            Повторите пароль
            <input
              type="password"
              name="confirm"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Создаём аккаунт…" : "Сохранить пароль и войти"}
          </button>
        </form>
      )}
      <p>
        <Link to="/admin">Уже есть аккаунт? Войти ↗</Link>
      </p>
    </section>
  );
}
function Cancel({ notify }: { notify: (s: string) => void }) {
  const [params] = useSearchParams(),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const token = params.get("token"),
    gift_id = params.get("gift");
  return (
    <section className="admin">
      <span className="micro">a change of plans</span>
      <h1>
        release a wish<span>.</span>
      </h1>
      {done ? (
        <>
          <p>Бронь отменена. Подарок снова доступен.</p>
          <Link to="/">В коллекцию ↗</Link>
        </>
      ) : !token || !gift_id ? (
        <p>Неполная ссылка отмены.</p>
      ) : (
        <>
          <p>
            Отменить вашу бронь? Это действие освободит подарок для других
            гостей.
          </p>
          <button
            className="primary"
            disabled={busy || !configured}
            onClick={async () => {
              setBusy(true);
              try {
                await action("cancel", { gift_id, token });
                setDone(true);
                history.replaceState(
                  null,
                  "",
                  location.pathname + location.search + "#/cancel",
                );
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Отменяем…" : "Да, отменить бронь"}
          </button>
        </>
      )}
    </section>
  );
}
type Suggestion = Gift & { status: string };
function Admin({ notify }: { notify: (s: string) => void }) {
  const [session, setSession] = useState<Session | null>(null),
    [allowed, setAllowed] = useState(false),
    [loading, setLoading] = useState(configured),
    [gifts, setGifts] = useState<Gift[]>([]),
    [suggestions, setSuggestions] = useState<Suggestion[]>([]),
    [edit, setEdit] = useState<Partial<Gift> | null>(null),
    [pending, setPending] = useState(""),
    [error, setError] = useState("");
  async function reload() {
    const [g, s] = await Promise.all([
      db.from("gifts").select("*").order("created_at", { ascending: false }),
      db
        .from("suggestions")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);
    if (g.error || s.error) throw g.error || s.error;
    setGifts(g.data || []);
    setSuggestions(s.data || []);
  }
  useEffect(() => {
    if (!configured) return;
    void db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = db.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!configured) return;
    if (!session) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    void db.rpc("is_admin").then(async ({ data, error }) => {
      setAllowed(Boolean(data));
      if (error) setError(error.message);
      if (data)
        try {
          await reload();
        } catch (e) {
          setError((e as Error).message);
        }
      setLoading(false);
    });
  }, [session?.user.id]);
  return (
    <section className="admin">
      <div className="section-heading">
        <span className="micro">just for sonya</span>
        {session && (
          <button onClick={() => void db.auth.signOut()}>Выйти ↗</button>
        )}
      </div>
      <h1>
        the edit<span>.</span>
      </h1>
      {!configured ? (
        <p>Сначала подключите Supabase: откройте README в проекте.</p>
      ) : loading ? (
        <p role="status">Проверяем доступ…</p>
      ) : !session ? (
        <form
          className="login"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setPending("login");
            setError("");
            const { error } = await db.auth.signInWithPassword({
              email: String(f.get("email")),
              password: String(f.get("password")),
            });
            if (error) setError("Не удалось войти. Проверьте email и пароль.");
            setPending("");
          }}
        >
          <p>Вход для владелицы коллекции.</p>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary" disabled={!!pending}>
            Войти
          </button>
        </form>
      ) : !allowed ? (
        <p>У этого аккаунта нет доступа администратора.</p>
      ) : (
        <>
          <button className="primary" onClick={() => setEdit({})}>
            + Добавить подарок
          </button>
          <h2>Коллекция · {gifts.length}</h2>
          {gifts.map((g) => (
            <div className="admin-row" key={g.id}>
              <div>
                <b>{g.title}</b>
                <small>
                  {g.category} {g.reserved ? "· reserved" : ""}
                </small>
              </div>
              <button onClick={() => setEdit(g)}>Изменить</button>
              <button
                disabled={!!pending}
                onClick={async () => {
                  if (!confirm(`Удалить «${g.title}»?`)) return;
                  setPending(g.id);
                  try {
                    const { error } = await db
                      .from("gifts")
                      .delete()
                      .eq("id", g.id);
                    if (error) throw error;
                    await reload();
                  } catch (e) {
                    notify((e as Error).message);
                  } finally {
                    setPending("");
                  }
                }}
              >
                Удалить
              </button>
            </div>
          ))}
          <h2>Предложения · {suggestions.length}</h2>
          {!suggestions.length && <p>Новых предложений пока нет.</p>}
          {suggestions.map((s) => (
            <div className="suggestion-row" key={s.id}>
              {s.image_url && <img src={s.image_url} alt={s.title} />}
              <div>
                <b>{s.title}</b>
                <p>{s.description}</p>
                {s.shop_url && (
                  <a
                    href={safeUrl(s.shop_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Открыть ссылку ↗
                  </a>
                )}
              </div>
              {["approve", "reject"].map((a) => (
                <button
                  key={a}
                  disabled={!!pending}
                  onClick={async () => {
                    setPending(s.id);
                    try {
                      await action(a, { suggestion_id: s.id });
                      await reload();
                      notify(
                        a === "approve"
                          ? "Подарок добавлен."
                          : "Предложение отклонено.",
                      );
                    } catch (e) {
                      notify((e as Error).message);
                    } finally {
                      setPending("");
                    }
                  }}
                >
                  {a === "approve" ? "Одобрить" : "Отклонить"}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {edit && (
        <Modal
          title={edit.id ? "Edit a little wish" : "A new little wish"}
          close={() => setEdit(null)}
        >
          <GiftForm
            initial={edit}
            onSave={async (value) => {
              const q = edit.id
                ? db.from("gifts").update(value).eq("id", edit.id)
                : db.from("gifts").insert(value);
              const { error } = await q;
              if (error) throw error;
              setEdit(null);
              await reload();
              notify("Подарок сохранён.");
            }}
          />
        </Modal>
      )}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
