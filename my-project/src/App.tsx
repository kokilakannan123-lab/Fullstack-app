
import './App.css';

function App() {
  return (
    <div className="App">
      <h1>Welcome to Kokila Fullstack App</h1>
      <p>React frontend connected to FastAPI backend.</p>

      <button
        onClick={async () => {
          try {
            const response = await fetch('/api/hello');
            const data = await response.json();
            alert(data.message);
          } catch (error) {
            alert('Unable to connect to the backend.');
          }
        }}
      >
        Test Backend
      </button>
    </div>
  );
}

export default App;
