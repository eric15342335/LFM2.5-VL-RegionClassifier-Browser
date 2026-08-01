import { Box, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import type { ModelManifest } from "../domain/schemas";
import {
  describeExecutionProfile,
  executionOptionValue,
  moduleExecutionOptions,
  parseExecutionOption,
  updateExecutionProfile,
  type ExecutionProfile,
  type ModelModule,
} from "../inference/execution-profile";
import type { BrowserCapability } from "../types";

const SELECTS: readonly Readonly<{
  module: ModelModule;
  label: string;
  description: string;
}>[] = [
  {
    module: "vision_encoder",
    label: "Vision encoder",
    description: "Image feature extraction",
  },
  {
    module: "decoder_model_merged",
    label: "Text decoder",
    description: "Autoregressive generation",
  },
  {
    module: "embed_tokens",
    label: "Token embeddings",
    description: "Language token lookup",
  },
];

type Props = Readonly<{
  manifest: ModelManifest;
  capability: BrowserCapability;
  profile: ExecutionProfile;
  disabled?: boolean;
  onChange: (profile: ExecutionProfile) => void;
}>;

export function ModelExecutionSelects({
  manifest,
  capability,
  profile,
  disabled = false,
  onChange,
}: Props) {
  return (
    <Stack gap="xs">
      <Box>
        <Text fw={700}>Model execution</Text>
      </Box>
      <SimpleGrid cols={3}>
        {SELECTS.map(({ module, label, description }) => {
          const options = moduleExecutionOptions(manifest, capability, profile, module);
          const detailsByValue = new Map(options.map((option) => [option.value, option]));
          const value = executionOptionValue(profile.dtype[module], profile.device[module]);

          return (
            <Select
              key={module}
              label={label}
              description={description}
              value={value}
              disabled={disabled}
              allowDeselect={false}
              searchable
              maxDropdownHeight={360}
              data={options.map((option) => ({
                value: option.value,
                label: option.label,
                disabled: !option.available,
              }))}
              renderOption={({ option }) => {
                const details = detailsByValue.get(option.value);

                return (
                  <Box>
                    <Text size="sm">{option.label}</Text>
                    {details?.reason ? (
                      <Text
                        size="xs"
                        c="dimmed"
                      >
                        {details.reason}
                      </Text>
                    ) : null}
                  </Box>
                );
              }}
              onChange={(nextValue) => {
                if (!nextValue) return;
                onChange(updateExecutionProfile(profile, module, parseExecutionOption(nextValue)));
              }}
            />
          );
        })}
      </SimpleGrid>
      <Text
        size="xs"
        c="dimmed"
      >
        Selected: {describeExecutionProfile(profile)}
      </Text>
    </Stack>
  );
}
