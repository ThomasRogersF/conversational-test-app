import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Menu, LevelSelect, ScenarioSelect, SessionScreen, QuizScreen, CompleteScreen } from './screens';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Menu />} />
                <Route path="/levels" element={<LevelSelect />} />
                <Route path="/scenarios/:levelId" element={<ScenarioSelect />} />
                <Route path="/session/:sessionId" element={<SessionScreen />} />
                <Route path="/quiz/:quizId" element={<QuizScreen />} />
                <Route path="/complete" element={<CompleteScreen />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
