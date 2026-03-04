import { Box } from "@mantine/core"
import { SettingsForm as SettingsContent } from "../components/settings-form"

export function SettingsPage() {
  return (
    <Box 
      display="flex" 
      style={{ 
        justifyContent: "center", 
        width: "100%",
        paddingTop: "20px"
      }}
    >
      <SettingsContent />
    </Box>
  )
}