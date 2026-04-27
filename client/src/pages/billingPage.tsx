import { Box } from '@mantine/core'
import { BillingDashboard } from '../components/billing-dashboard'

export function BillingPage() {
  return (
    <Box
      display="flex"
      style={{
        justifyContent: 'center',
        width: '100%',
        paddingTop: '20px',
      }}
    >
      <BillingDashboard />
    </Box>
  )
}
