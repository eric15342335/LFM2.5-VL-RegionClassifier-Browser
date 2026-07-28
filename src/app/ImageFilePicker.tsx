import { Box, Button, Group, Paper, Text } from "@mantine/core";
import { useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { ACCEPTED_IMAGE_MIME_TYPES } from "../image-format";

type ImageFilePickerProps = Readonly<{
  disabled: boolean;
  maxSize: number;
  openRef: MutableRefObject<(() => void) | null>;
  onAccept: (file: File) => void;
  onReject: () => void;
  onIntent?: () => void;
  children: ReactNode;
}>;

const acceptedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

function isAccepted(file: File, maxSize: number): boolean {
  return (
    file.size <= maxSize &&
    (ACCEPTED_IMAGE_MIME_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_MIME_TYPES)[number]) ||
      (!file.type &&
        acceptedExtensions.some((extension) => file.name.toLowerCase().endsWith(extension))))
  );
}

export function ImageFilePicker({
  disabled,
  maxSize,
  openRef,
  onAccept,
  onReject,
  onIntent,
  children,
}: ImageFilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  openRef.current = () => {
    if (!disabled) inputRef.current?.click();
  };

  const processFile = (file: File | undefined) => {
    if (!file || !isAccepted(file, maxSize)) return onReject();
    onAccept(file);
  };

  return (
    <Paper
      p="md"
      className="picker-root"
      data-disabled={disabled || undefined}
      data-drag-active={dragActive || undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) {
          setDragActive(true);
          onIntent?.();
        }
      }}
      onDragOver={(event) => {
        if (!disabled) event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        if (!disabled) processFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_MIME_TYPES.join(",")}
        multiple={false}
        disabled={disabled}
        aria-label="Upload image"
        className="visually-hidden"
        onChange={(event) => {
          processFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      {children}
      <Group justify="flex-end">
        <Button
          variant="light"
          disabled={disabled}
          onFocus={onIntent}
          onPointerEnter={onIntent}
          onClick={() => openRef.current?.()}
        >
          Browse
        </Button>
      </Group>
    </Paper>
  );
}

export function EmptyImageWorkspace() {
  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      h="100%"
    >
      <Text fw={700}>Image workspace</Text>
      <Text
        size="sm"
        c="dimmed"
      >
        Choose an image to begin.
      </Text>
      <Box
        className="image-canvas-shell"
        data-empty="true"
        mt="md"
      >
        <Text c="dimmed">No image loaded</Text>
      </Box>
    </Paper>
  );
}
