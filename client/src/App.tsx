import './App.css'
import { useQuery } from '@tanstack/react-query'

function App() {
  const { data: message, isLoading } = useQuery({
    queryKey: ["message"],
    queryFn: () => fetch('http://localhost:3000/hello').then(res => res.json())
  });

  if (isLoading) {
    return <div>Loading...</div>
  }

  return (
    <div>
      <h1>Message from Fastify backend:</h1>
      <p>{message.message}</p>
    </div>
  )
}

export default App;
