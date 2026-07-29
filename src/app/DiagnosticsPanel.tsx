import {
  Accordion,
  Button,
  Code,
  CopyButton,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { INFERENCE_CONFIG } from "../config";
import type { BrowserCapability, ProgressEvent } from "../types";
import type { LatestResult } from "./app.machine";
import { formatDuration } from "./format";

type Props = Readonly<{
  capability: BrowserCapability | null;
  events: ProgressEvent[];
  result: LatestResult | null;
  technicalError: string | null;
  onClearEvents: () => void;
}>;

function JsonBlock({ value }: Readonly<{ value: unknown }>) {
  const text = JSON.stringify(value, null, 2);

  return (
    <Stack gap="xs">
      <Group justify="flex-end">
        <CopyButton value={text}>
          {({ copied, copy }) => (
            <Button
              size="xs"
              variant="subtle"
              onClick={copy}
            >
              {copied ? "Copied" : "Copy JSON"}
            </Button>
          )}
        </CopyButton>
      </Group>
      <ScrollArea h={280}>
        <Code block>{text}</Code>
      </ScrollArea>
    </Stack>
  );
}

export function DiagnosticsPanel({
  capability,
  events,
  result,
  technicalError,
  onClearEvents,
}: Props) {
  const [openItems, setOpenItems] = useState<string[]>(technicalError ? ["error"] : []);

  useEffect(() => {
    if (technicalError) setOpenItems((items) => [...new Set([...items, "error"])]);
  }, [technicalError]);

  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
    >
      <Stack gap="md">
        <Title
          order={2}
          size="h3"
        >
          Diagnostics
        </Title>
        <Accordion
          variant="separated"
          multiple
          value={openItems}
          onChange={setOpenItems}
        >
          {technicalError && (
            <Accordion.Item value="error">
              <Accordion.Control>Technical error</Accordion.Control>
              <Accordion.Panel>
                <Code block>{technicalError}</Code>
              </Accordion.Panel>
            </Accordion.Item>
          )}
          <Accordion.Item value="events">
            <Accordion.Control>Event log ({events.length})</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Group justify="flex-end">
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={!events.length}
                    onClick={onClearEvents}
                  >
                    Clear
                  </Button>
                </Group>
                <Table.ScrollContainer minWidth={540}>
                  <Table
                    striped
                    withTableBorder
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Stage</Table.Th>
                        <Table.Th>Message</Table.Th>
                        <Table.Th>Progress</Table.Th>
                        <Table.Th>Elapsed</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {events.map((event, index) => (
                        <Table.Tr key={`${event.stage}-${event.elapsedMs}-${index}`}>
                          <Table.Td>{event.stage}</Table.Td>
                          <Table.Td>{event.message}</Table.Td>
                          <Table.Td>{Math.round(event.progress)}%</Table.Td>
                          <Table.Td>{formatDuration(event.elapsedMs)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                {!events.length && (
                  <Text
                    size="sm"
                    c="dimmed"
                  >
                    No worker events recorded.
                  </Text>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="capability">
            <Accordion.Control>Capability and configuration</Accordion.Control>
            <Accordion.Panel>
              <JsonBlock value={{ capability, config: INFERENCE_CONFIG }} />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="result">
            <Accordion.Control>Raw result</Accordion.Control>
            <Accordion.Panel>
              <JsonBlock value={result} />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Paper>
  );
}
