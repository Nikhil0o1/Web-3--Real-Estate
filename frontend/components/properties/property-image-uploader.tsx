"use client";

import { ImagePlus, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 8;
const MAX_FILE_SIZE = 1_500_000;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type PropertyImageUploaderProps = {
  images: string[];
  onChange: (images: string[]) => void;
};

export function PropertyImageUploader({ images, onChange }: PropertyImageUploaderProps) {
  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const slots = Math.max(0, MAX_IMAGES - images.length);
    if (slots <= 0) {
      toast.error(`You can upload up to ${MAX_IMAGES} images.`);
      return;
    }

    const next: string[] = [];
    for (const file of files.slice(0, slots)) {
      if (!ACCEPTED_TYPES.has(file.type)) {
        toast.error(`${file.name} is not a supported image type.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} is too large. Keep images under 1.5 MB.`);
        continue;
      }
      next.push(await readAsDataUrl(file));
    }
    if (next.length) onChange([...images, ...next]);
  }

  function removeAt(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }

  return (
    <div className="grid min-w-0 gap-2">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          event.currentTarget.classList.add("border-primary/50", "bg-primary/5");
        }}
        onDragLeave={(event) => {
          event.currentTarget.classList.remove("border-primary/50", "bg-primary/5");
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.currentTarget.classList.remove("border-primary/50", "bg-primary/5");
          void addFiles(event.dataTransfer.files);
        }}
        className="flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/35"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-background text-primary">
            <ImagePlus className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Property images</span>
            <span className="block truncate text-xs text-muted-foreground">
              Drag images here or browse. JPG, PNG, WebP or GIF.
            </span>
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium">
          <Upload className="h-3.5 w-3.5" />
          Upload
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>

      {images.length ? (
        <div className="grid grid-cols-4 gap-2">
          {images.map((src, index) => (
            <div key={`${src.slice(0, 32)}-${index}`} className="group relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted">
              <img src={src} alt="" className="h-full w-full object-cover" />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className={cn(
                  "absolute right-1 top-1 h-6 w-6 opacity-90 shadow-sm",
                  "group-hover:opacity-100",
                )}
                onClick={() => removeAt(index)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
