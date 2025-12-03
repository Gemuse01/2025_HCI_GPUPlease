import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { UserPersona } from '../types';

const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const { updateUser } = useApp();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    goal: 'learning' as 'learning' | 'practice' | 'wealth',
    risk: 'medium' as 'low' | 'medium' | 'high',
    persona: UserPersona.UNDECIDED
  });

  // 컴포넌트가 마운트될 때 step을 1로 초기화
  useEffect(() => {
    setStep(1);
    setFormData({
      name: '',
      goal: 'learning',
      risk: 'medium',
      persona: UserPersona.UNDECIDED
    });
  }, []);

  const handleNext = () => setStep(p => p + 1);
  const handleBack = () => setStep(p => p - 1);

  const completeOnboarding = () => {
    updateUser({
      name: formData.name,
      goal: formData.goal,
      risk_tolerance: formData.risk,
      persona: formData.persona,
      is_onboarded: true
    });
    navigate('/');
  };

  const quizOptions = [
    { type: UserPersona.HELPER_SEEKER, text: "A) When stuck, I immediately ask experts or communities for help." },
    { type: UserPersona.STRUGGLER, text: "B) I try to solve it myself and hesitate to ask for help." },
    { type: UserPersona.OPTIMIST, text: "C) I believe effort leads to profit and actively try new opportunities." },
    { type: UserPersona.APATHETIC, text: "D) My goals are vague, and my motivation fades quickly." },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Welcome to FinGuide AI
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Let's personalize your experience in 3 quick steps.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">What should we call you?</label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm text-gray-900 bg-white"
                  placeholder="Your Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">What is your primary goal?</label>
                <div className="grid grid-cols-1 gap-2">
                  {['learning', 'practice', 'wealth'].map((g) => (
                    <button
                      key={g}
                      onClick={() => setFormData({ ...formData, goal: g as any })}
                      className={`py-3 px-4 border rounded-md text-left capitalize transition-colors ${formData.goal === g ? 'border-primary-500 ring-2 ring-primary-200 bg-primary-50 text-primary-900' : 'border-gray-300 hover:bg-gray-50 text-gray-900 bg-white'}`}
                    >
                      {g === 'learning' ? '📚 Learning Basics' : g === 'practice' ? '🎮 Risk-free Practice' : '💰 Growing Wealth'}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleNext}
                disabled={!formData.name}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none disabled:opacity-50 transition-colors"
              >
                Next
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">Just one question to understand you better.</h3>
              <p className="text-sm text-gray-500">Q. In investing (or new tasks), how do you usually act?</p>
              <div className="space-y-3">
                {quizOptions.map((opt) => (
                  <button
                    key={opt.type}
                    onClick={() => {
                      setFormData({ ...formData, persona: opt.type });
                    }}
                    className={`w-full py-3 px-4 border rounded-md text-left text-sm transition-colors ${formData.persona === opt.type ? 'border-primary-500 ring-2 ring-primary-200 bg-primary-50 text-primary-900' : 'border-gray-300 hover:bg-gray-50 text-gray-900 bg-white'}`}
                  >
                    {opt.text}
                  </button>
                ))}
              </div>
              <div className="flex justify-between">
                <button onClick={handleBack} className="text-gray-500 hover:text-gray-700 text-sm font-medium px-3 py-2">Back</button>
                {formData.persona !== UserPersona.UNDECIDED && (
                    <button onClick={handleNext} className="bg-primary-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-primary-700 transition-colors">Next</button>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
               <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">How comfortable are you with risk?</label>
                <p className="text-xs text-gray-500 mb-3">This adjusts our safety guardrails for you.</p>
                <div className="grid grid-cols-3 gap-2">
                  {['low', 'medium', 'high'].map((r) => (
                    <button
                      key={r}
                      onClick={() => setFormData({ ...formData, risk: r as any })}
                      className={`py-2 px-2 border rounded-md text-center capitalize text-sm transition-colors ${formData.risk === r ? 'border-primary-500 ring-2 ring-primary-200 bg-primary-50 text-primary-900' : 'border-gray-300 hover:bg-gray-50 text-gray-900 bg-white'}`}
                    >
                      {r}
                      {r === 'low' && ' 🛡️'}
                      {r === 'high' && ' 🎢'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-blue-50 p-4 rounded-md border border-blue-100">
                <h4 className="font-medium text-blue-900 mb-1">Summary</h4>
                 <ul className="text-sm text-blue-800 list-disc list-inside">
                   <li>Goal: <span className="capitalize">{formData.goal}</span></li>
                   <li>Style: {quizOptions.find(o => o.type === formData.persona)?.text.substring(0, 15)}...</li>
                   <li>Risk: <span className="capitalize">{formData.risk}</span></li>
                 </ul>
              </div>

              <button
                onClick={completeOnboarding}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-success hover:bg-green-600 focus:outline-none transition-colors"
              >
                Start My Journey 🚀
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Onboarding;