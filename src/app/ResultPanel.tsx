import { Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import type { LatestResult, LoadedImage } from "./app.machine";
import { ResultDetails } from "./ResultDetails";

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
          <ResultDetails
            result={result}
            image={image}
          />
        )}
      </Stack>
    </Paper>
  );
}
