import { useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Camera, Loader2 } from 'lucide-react';
import { useUpdateProfileImage } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';

// Profile images are sent as small data URLs and stored inline on the profile
// row (there is no object storage on the deploy target). Anything a phone or
// camera produces is downscaled to a 256px square before it leaves the browser,
// which keeps both the upload and every later dashboard read cheap.
const MAX_UPLOAD_BYTES = 5_000_000;
const MAX_EDGE = 256;

async function fileToImage(file: File): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be read.'));
    image.src = dataUrl;
  });
}

export async function prepareProfileImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG, JPG, WEBP or GIF).');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is too large — choose one under 5 MB.');
  const image = await fileToImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('That image could not be processed.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

export function initialsFor(name: string) {
  return name.split(' ').filter(Boolean).map((word) => word[0]).slice(0, 2).join('').toUpperCase() || 'SL';
}

// Renders the stored image when there is one, otherwise initials. Used by every
// role's header and profile card so the four dashboards look consistent.
export function ProfileAvatar({
  name,
  image,
  className,
  textClassName,
  testId,
}: {
  name: string;
  image?: string | null;
  className?: string;
  textClassName?: string;
  testId?: string;
}) {
  return (
    <span data-testid={testId} className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-[hsl(var(--accent))] font-black text-[hsl(var(--accent-foreground))]', className)}>
      {image ? <img src={image} alt={name} className="h-full w-full object-cover" /> : <span className={textClassName}>{initialsFor(name)}</span>}
    </span>
  );
}

// The uploader itself: a small avatar plus a button that opens the file picker.
// Works for every role because it posts to the shared /auth/profile route; the
// caller passes the query keys to refresh so each dashboard stays in step.
export function ProfileImageEditor({
  name,
  image,
  invalidateKeys = [],
  className,
  size = 'md',
  label = 'Change photo',
}: {
  name: string;
  image?: string | null;
  invalidateKeys?: QueryKey[];
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  const client = useQueryClient();
  const update = useUpdateProfileImage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const avatarSize = size === 'lg' ? 'size-20' : size === 'sm' ? 'size-10' : 'size-14';

  const onFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      const dataUrl = await prepareProfileImage(file);
      setPreview(dataUrl);
      update.mutate(
        { data: { profileImage: dataUrl } },
        {
          onSuccess: () => {
            for (const key of invalidateKeys) client.invalidateQueries({ queryKey: key });
          },
          onError: (mutationError) => {
            setPreview(null);
            setError(mutationError instanceof Error ? mutationError.message : 'We could not save that image.');
          },
        },
      );
    } catch (readError) {
      setPreview(null);
      setError(readError instanceof Error ? readError.message : 'That image could not be read.');
    }
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <ProfileAvatar name={name} image={preview ?? image} className={avatarSize} textClassName={size === 'lg' ? 'text-lg' : 'text-xs'} />
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={update.isPending}
          data-testid="button-change-photo"
          className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold text-[hsl(var(--foreground))] hover:border-[hsl(var(--accent))] disabled:opacity-60"
        >
          {update.isPending ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          {update.isPending ? 'Saving…' : label}
        </button>
        {error && <p data-testid="status-photo-error" className="mt-1.5 text-[11px] font-semibold text-[#93473a]">{error}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        data-testid="input-profile-photo"
        onChange={(event) => {
          void onFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}

// Compact variant for the role headers: the avatar itself is the button, with a
// gold camera badge. Same upload path as ProfileImageEditor.
export function AvatarUploader({
  name,
  image,
  invalidateKeys = [],
  className,
  size = 'sm',
}: {
  name: string;
  image?: string | null;
  invalidateKeys?: QueryKey[];
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const client = useQueryClient();
  const update = useUpdateProfileImage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const avatarSize = size === 'lg' ? 'size-20' : size === 'sm' ? 'size-9' : 'size-14';

  const onFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      const dataUrl = await prepareProfileImage(file);
      setPreview(dataUrl);
      update.mutate(
        { data: { profileImage: dataUrl } },
        {
          onSuccess: () => {
            for (const key of invalidateKeys) client.invalidateQueries({ queryKey: key });
          },
          onError: (mutationError) => {
            setPreview(null);
            setError(mutationError instanceof Error ? mutationError.message : 'We could not save that image.');
          },
        },
      );
    } catch (readError) {
      setPreview(null);
      setError(readError instanceof Error ? readError.message : 'That image could not be read.');
    }
  };

  return (
    <div className={cn('relative', className)}>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={update.isPending} title="Add or change profile photo" data-testid="button-avatar-upload" className="relative block disabled:opacity-60">
        <ProfileAvatar name={name} image={preview ?? image} className={avatarSize} textClassName="text-xs" />
        <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
          {update.isPending ? <Loader2 size={9} className="animate-spin" /> : <Camera size={9} />}
        </span>
      </button>
      {error && <p className="absolute right-0 top-full z-10 mt-1 w-40 text-right text-[10px] font-semibold text-[#f3b8ae]">{error}</p>}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" data-testid="input-profile-photo" onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
  );
}

