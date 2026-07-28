import { Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { lazy, Suspense } from "react";
import type { LatestResult, LoadedImage } from "./app.machine";

const LazyResultDetails = lazy(() =>
  import("./ResultDetails").then((module) => ({ default: module.ResultDetails }))
);

export function ResultPanel({
  result,
  image,
}: Readonly<{ result: LatestResult | null; image: LoadedImage | null }>) {
  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      h="100%"
    >
      <Stack gap="md">
        <Title
          order={2}
          size="h3"
        >
          Result
        </Title>
        {!result ? (
          <Stack
            align="center"
            justify="center"
            className="result-empty"
            gap="xs"
          >
            <ThemeIcon
              size="xl"
              radius="xl"
              variant="light"
            >
              ?
            </ThemeIcon>
            <Text fw={600}>No classification yet</Text>
            <Text
              size="sm"
              c="dimmed"
              ta="center"
            >
              Load the model, choose an image, and select one subject.
            </Text>
          </Stack>
        ) : (
          <Suspense
            fallback={
              <Text
                size="sm"
                c="dimmed"
              >
                Loading result…
              </Text>
            }
          >
            <LazyResultDetails
              result={result}
              image={image}
            />
          </Suspense>
        )}
      </Stack>
    </Paper>
  );
}
