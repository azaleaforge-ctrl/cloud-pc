import { useState, type FormEvent } from 'react';
import type { AppState } from '../../shared/types';
import { IconEnter, IconPlus, IconWifi, LogoMark, Spinner } from './icons';
import { Field, FolderPicker, FooterBar, VersionModal } from './ui';

interface LandingProps {
  state: AppState;
  onError: (message: string) => void;
}

function CreateCard({
  defaultName,
  onError,
}: {
  defaultName: string;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [roomName, setRoomName] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ name?: string; room?: string; folder?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickFolder = async () => {
    try {
      const f = await window.rk.pickFolder();
      if (f) {
        setFolder(f);
        setErrors((e) => ({ ...e, folder: undefined }));
      }
    } catch {
      onError('Gagal membuka dialog pilih folder.');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Nama wajib diisi.';
    if (!roomName.trim()) errs.room = 'Nama ruangan wajib diisi.';
    if (!folder) errs.folder = 'Pilih folder project terlebih dahulu.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setFormError(null);
    const picked = folder;
    if (!picked) return; // sudah divalidasi di atas
    try {
      const res = await window.rk.createRoom({
        folder: picked,
        roomName: roomName.trim(),
        memberName: name.trim(),
      });
      if (!res.ok) setFormError(res.error ?? 'Gagal membuat ruangan.');
    } catch {
      setFormError('Gagal membuat ruangan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mode-card mode-card-create" aria-labelledby="create-title">
      <div className="mode-head">
        <span className="mode-icon mode-icon-teal">
          <IconPlus size={20} />
        </span>
        <div>
          <h2 className="mode-title" id="create-title">
            Buat Ruangan
          </h2>
          <p className="mode-sub">Jadi host - bagikan folder project dari laptopmu.</p>
        </div>
      </div>
      <form className="mode-form" onSubmit={submit} noValidate>
        <Field label="Nama kamu" error={errors.name}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis. Dita"
            maxLength={32}
            autoComplete="off"
          />
        </Field>
        <Field label="Nama ruangan" error={errors.room}>
          <input
            className="input"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="mis. Project Toko"
            maxLength={40}
            autoComplete="off"
          />
        </Field>
        <Field label="Folder project" error={errors.folder}>
          <FolderPicker folder={folder} onPick={pickFolder} disabled={busy} />
        </Field>
        {formError ? (
          <div className="form-error" role="alert">
            {formError}
          </div>
        ) : null}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? <Spinner size={16} /> : <IconPlus size={17} />}
          {busy ? 'Membuat ruangan…' : 'Buat Ruangan'}
        </button>
      </form>
    </section>
  );
}

function JoinCard({
  defaultName,
  onError,
}: {
  defaultName: string;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onCodeChange = (v: string) => {
    setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Nama wajib diisi.';
    if (code.length !== 6) errs.code = 'Kode ruangan harus 6 karakter.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setFormError(null);
    try {
      const res = await window.rk.joinRoom({ code, memberName: name.trim() });
      if (!res.ok) setFormError(res.error ?? 'Gagal gabung ke ruangan.');
    } catch {
      setFormError('Gagal gabung ke ruangan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mode-card mode-card-join" aria-labelledby="join-title">
      <div className="mode-head">
        <span className="mode-icon mode-icon-amber">
          <IconEnter size={20} />
        </span>
        <div>
          <h2 className="mode-title" id="join-title">
            Gabung Ruangan
          </h2>
          <p className="mode-sub">Jadi anggota - minta kode dari host.</p>
        </div>
      </div>
      <form className="mode-form" onSubmit={submit} noValidate>
        <Field label="Nama kamu" error={errors.name}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis. Bima"
            maxLength={32}
            autoComplete="off"
          />
        </Field>
        <Field label="Kode ruangan" error={errors.code} hint="6 karakter, huruf dan angka.">
          <input
            className="input input-code"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="ABC123"
            maxLength={6}
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        {formError ? (
          <div className="form-error" role="alert">
            {formError}
          </div>
        ) : null}
        <button type="submit" className="btn btn-amber btn-lg" disabled={busy}>
          {busy ? <Spinner size={16} /> : <IconEnter size={17} />}
          {busy ? 'Menyambung…' : 'Gabung Ruangan'}
        </button>
        <div className="join-hint">
          <IconWifi size={16} />
          <span>
            Pastikan host sedang aktif dan terhubung ke <b>WiFi yang sama</b> denganmu, lalu masukkan
            kode ruangan yang dibagikan.
          </span>
        </div>
      </form>
    </section>
  );
}

export function Landing({ state, onError }: LandingProps) {
  const [showVersion, setShowVersion] = useState(false);
  return (
    <div className="landing">
      <header className="app-header">
        <div className="brand">
          <LogoMark size={26} />
          <div>
            <div className="brand-name">Ruang Kerja</div>
            <div className="brand-tag">Kolaborasi coding di jaringan lokal</div>
          </div>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <h1>
            Satu folder project, <em>satu giliran kerja</em>.
          </h1>
          <p>
            Buat ruangan dari laptopmu atau gabung pakai kode. Folder project tersinkron otomatis,
            giliran bekerja diatur rapi, dan dev server bisa dinyalakan bersama.
          </p>
        </section>

        <div className="landing-cards">
          <CreateCard defaultName={state.selfName} onError={onError} />
          <JoinCard defaultName={state.selfName} onError={onError} />
        </div>
      </main>

      <footer className="app-footer">
        <FooterBar state={state} onVersionClick={() => setShowVersion(true)} />
      </footer>
      <VersionModal open={showVersion} onClose={() => setShowVersion(false)} />
    </div>
  );
}
